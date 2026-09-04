#
# Copyright (c) 2025 Elara AI Pty Ltd
# Licensed under the Business Source License 1.1. See LICENSE.md for details.
#
"""PyTorch Lightning model classes behind the ``lightning`` platform functions.

Imported lazily by ``lightning_impl`` on first use, so importing
``east_py_datascience`` never loads torch or pytorch_lightning: the
``lightning`` extra may be absent, and torch alone takes seconds to import.
Everything that needs a torch base class lives here, together with the
state-dict serialisation the model blob carries.
"""

from __future__ import annotations

import logging
import os
import pickle
from collections.abc import Callable

# Lightning reads these at import time; set them before it loads. setdefault
# leaves an explicit user setting alone.
os.environ.setdefault("PYTORCH_LIGHTNING_DISABLE_POSSIBLE_USER_WARNINGS", "1")
os.environ.setdefault("LT_DISABLE_STATUS_BAR", "1")

import pytorch_lightning as pl
import torch
import torch.nn as nn
import torch.nn.functional as F

# Lightning's rank-zero loggers announce seeds, devices and checkpoints on
# every fit; a platform function reports through its result, not stdout.
for _name in (
    "pytorch_lightning",
    "pytorch_lightning.utilities.rank_zero",
    "lightning",
    "lightning_fabric",
    "lightning_fabric.utilities.seed",
):
    logging.getLogger(_name).setLevel(logging.CRITICAL)

class _TemporalAutoencoder(nn.Module):
    """Base of the sequence models: encode to a latent, decode with an optional condition.

    ``LightningMLP`` narrows ``self.net`` to this class before calling
    ``encode`` / ``decode`` or passing a condition through ``forward``.
    """

    n_channels: int
    sequence_length: int
    latent_dim: int
    condition_dim: int | None

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        raise NotImplementedError

    def decode(self, z: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        raise NotImplementedError

    def forward(self, x: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        return self.decode(self.encode(x), condition)


class EpochCallback(pl.Callback):
    """Callback that invokes user-provided East function each epoch."""

    def __init__(self, fn: Callable):
        self.fn = fn

    def on_train_epoch_end(self, trainer: pl.Trainer, pl_module: pl.LightningModule) -> None:
        epoch = trainer.current_epoch
        train_loss = float(trainer.callback_metrics.get("train_loss", 0.0))
        val_loss = float(trainer.callback_metrics.get("val_loss", 0.0))
        # Call the East function directly - it's a compiled Python callable
        self.fn(epoch, train_loss, val_loss)


# ============================================================================
# Temporal Architecture Classes
# ============================================================================


class Conv1DAutoencoder(_TemporalAutoencoder):
    """1D Convolutional autoencoder for temporal patterns."""

    def __init__(
        self,
        n_channels: int,
        sequence_length: int,
        n_classes: int,
        conv_channels: list[int],
        kernel_size: int,
        latent_dim: int,
        condition_dim: int | None = None,
        dropout: float = 0.1,
    ):
        super().__init__()
        self.n_channels = n_channels
        self.sequence_length = sequence_length
        self.n_classes = n_classes
        self.latent_dim = latent_dim
        self.condition_dim = condition_dim

        # Input: [batch, n_channels, sequence_length, n_classes]
        # Reshape to: [batch, n_channels * n_classes, sequence_length]
        in_channels = n_channels * n_classes

        # Encoder: conv layers over sequence dimension
        encoder_layers = []
        prev_channels = in_channels
        for out_channels in conv_channels:
            encoder_layers.extend([
                nn.Conv1d(prev_channels, out_channels, kernel_size, padding=kernel_size // 2),
                nn.BatchNorm1d(out_channels),
                nn.ReLU(),
                nn.Dropout(dropout),
            ])
            prev_channels = out_channels

        self.encoder_conv = nn.Sequential(*encoder_layers)

        # Flatten and project to latent
        encoder_output_size = conv_channels[-1] * sequence_length
        self.encoder_fc = nn.Linear(encoder_output_size, latent_dim)

        # Decoder: project and reshape
        # Decoder input: latent + condition (if provided)
        decoder_input_dim = latent_dim + (condition_dim or 0)
        self.decoder_fc = nn.Linear(decoder_input_dim, encoder_output_size)

        # Decoder: transposed conv layers (mirror of encoder)
        decoder_layers = []
        prev_channels = conv_channels[-1]  # Start from encoder's final output
        for out_channels in reversed(conv_channels[:-1]):
            decoder_layers.extend([
                nn.ConvTranspose1d(prev_channels, out_channels, kernel_size, padding=kernel_size // 2),
                nn.BatchNorm1d(out_channels),
                nn.ReLU(),
                nn.Dropout(dropout),
            ])
            prev_channels = out_channels

        # Final layer to original channels
        decoder_layers.append(
            nn.ConvTranspose1d(prev_channels, in_channels, kernel_size, padding=kernel_size // 2)
        )
        self.decoder_conv = nn.Sequential(*decoder_layers)

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Encode to latent space."""
        batch_size = x.shape[0]
        # x: [batch, n_channels * sequence_length * n_classes]
        x = x.view(batch_size, self.n_channels, self.sequence_length, self.n_classes)
        # -> [batch, n_channels * n_classes, sequence_length]
        x = x.permute(0, 1, 3, 2).reshape(batch_size, -1, self.sequence_length)
        x = self.encoder_conv(x)
        x = x.flatten(1)
        return self.encoder_fc(x)

    def decode(self, z: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        """Decode from latent space."""
        if self.condition_dim is not None:
            if condition is None:
                raise ValueError("Model requires condition vector but none provided")
            if condition.shape[1] != self.condition_dim:
                raise ValueError(f"Expected condition_dim={self.condition_dim}, got {condition.shape[1]}")
            z = torch.cat([z, condition], dim=1)
        elif condition is not None:
            raise ValueError("Model has no condition_dim but condition was provided")

        batch_size = z.shape[0]
        x = self.decoder_fc(z)
        x = x.view(batch_size, -1, self.sequence_length)
        x = self.decoder_conv(x)
        # -> [batch, n_channels, n_classes, sequence_length]
        x = x.view(batch_size, self.n_channels, self.n_classes, self.sequence_length)
        # -> [batch, n_channels, sequence_length, n_classes]
        x = x.permute(0, 1, 3, 2)
        # -> [batch, n_channels * sequence_length * n_classes]
        return x.reshape(batch_size, -1)


class SequentialAutoencoder(_TemporalAutoencoder):
    """LSTM/GRU autoencoder for sequential dependencies."""

    def __init__(
        self,
        n_channels: int,
        sequence_length: int,
        n_classes: int,
        hidden_size: int,
        n_layers: int,
        cell_type: str,  # "lstm" or "gru" (from variant tag)
        latent_dim: int,
        bidirectional: bool = False,
        condition_dim: int | None = None,
        dropout: float = 0.1,
    ):
        if cell_type not in ("lstm", "gru"):
            raise ValueError(f"cell_type must be 'lstm' or 'gru', got '{cell_type}'")
        super().__init__()
        self.n_channels = n_channels
        self.sequence_length = sequence_length
        self.n_classes = n_classes
        self.hidden_size = hidden_size
        self.latent_dim = latent_dim
        self.bidirectional = bidirectional
        self.cell_type = cell_type
        self.condition_dim = condition_dim
        self.n_layers = n_layers

        input_size = n_channels * n_classes
        num_directions = 2 if bidirectional else 1

        RNNClass = nn.LSTM if cell_type == "lstm" else nn.GRU
        self.encoder_rnn = RNNClass(
            input_size=input_size,
            hidden_size=hidden_size,
            num_layers=n_layers,
            batch_first=True,
            bidirectional=bidirectional,
            dropout=dropout if n_layers > 1 else 0,
        )

        # Project final hidden state to latent
        encoder_output_size = hidden_size * num_directions * n_layers
        self.encoder_fc = nn.Linear(encoder_output_size, latent_dim)

        # Decoder: always unidirectional (bidirectional requires full sequence upfront)
        # Project latent to decoder's initial hidden state
        # Decoder input: latent + condition (if provided)
        decoder_input_dim = latent_dim + (condition_dim or 0)
        decoder_hidden_size = hidden_size * n_layers  # unidirectional
        self.decoder_fc = nn.Linear(decoder_input_dim, decoder_hidden_size)

        # Decoder input size includes condition_dim for autoregressive generation
        # (condition is concatenated to input at each timestep)
        decoder_rnn_input_size = input_size + (condition_dim or 0)
        self.decoder_rnn = RNNClass(
            input_size=decoder_rnn_input_size,
            hidden_size=hidden_size,
            num_layers=n_layers,
            batch_first=True,
            bidirectional=False,  # Always unidirectional for generation
            dropout=dropout if n_layers > 1 else 0,
        )

        # Output projection (decoder is always unidirectional)
        self.output_fc = nn.Linear(hidden_size, input_size)

    def init_hidden(self, batch_size: int, device: torch.device | None = None) -> torch.Tensor | tuple:
        """Initialize hidden state for autoregressive generation.

        Args:
            batch_size: Number of sequences to generate
            device: Device to create tensors on

        Returns:
            For LSTM: (h_0, c_0) tuple
            For GRU: h_0 tensor
        """
        if device is None:
            device = next(self.parameters()).device
        zeros = torch.zeros(self.n_layers, batch_size, self.hidden_size, device=device)
        if self.cell_type == "lstm":
            return (zeros, zeros.clone())
        return zeros

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Encode sequence to latent."""
        batch_size = x.shape[0]
        # x: [batch, n_channels * sequence_length * n_classes]
        x = x.view(batch_size, self.n_channels, self.sequence_length, self.n_classes)
        # -> [batch, sequence_length, n_channels * n_classes]
        x = x.permute(0, 2, 1, 3).reshape(batch_size, self.sequence_length, -1)

        _, hidden = self.encoder_rnn(x)
        if self.cell_type == "lstm":
            hidden = hidden[0]  # Take h, not c
        # hidden: [n_layers * num_directions, batch, hidden_size]
        hidden = hidden.permute(1, 0, 2).reshape(batch_size, -1)
        return self.encoder_fc(hidden)

    def decode(self, z: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        """Decode latent to sequence (parallel, not autoregressive)."""
        if self.condition_dim is not None:
            if condition is None:
                raise ValueError("Model requires condition vector but none provided")
            if condition.shape[1] != self.condition_dim:
                raise ValueError(f"Expected condition_dim={self.condition_dim}, got {condition.shape[1]}")
            z = torch.cat([z, condition], dim=1)
        elif condition is not None:
            raise ValueError("Model has no condition_dim but condition was provided")

        batch_size = z.shape[0]
        hidden = self.decoder_fc(z)
        # Reshape to RNN hidden state format (decoder is always unidirectional)
        hidden = hidden.view(batch_size, self.n_layers, self.hidden_size)
        hidden = hidden.permute(1, 0, 2).contiguous()

        if self.cell_type == "lstm":
            hidden = (hidden, torch.zeros_like(hidden))

        # Parallel decoding: use zeros as input, hidden state provides context
        # This is NOT autoregressive - all positions decoded simultaneously
        decoder_input = torch.zeros(
            batch_size, self.sequence_length, self.n_channels * self.n_classes,
            device=z.device
        )
        # If using conditions, concatenate condition to each timestep
        if self.condition_dim is not None and condition is not None:
            # condition: (batch, condition_dim) -> (batch, sequence_length, condition_dim)
            cond_expanded = condition.unsqueeze(1).expand(-1, self.sequence_length, -1)
            decoder_input = torch.cat([decoder_input, cond_expanded], dim=-1)
        output, _ = self.decoder_rnn(decoder_input, hidden)
        output = self.output_fc(output)

        # -> [batch, sequence_length, n_channels, n_classes]
        output = output.view(batch_size, self.sequence_length, self.n_channels, self.n_classes)
        # -> [batch, n_channels, sequence_length, n_classes]
        output = output.permute(0, 2, 1, 3)
        return output.reshape(batch_size, -1)


class TransformerAutoencoder(_TemporalAutoencoder):
    """Transformer autoencoder with positional encoding.

    Note: The decoder uses self-attention with the decoded sequence serving as both
    query and memory. This is intentional - at decode time we don't have encoder
    outputs to cross-attend to (unlike seq2seq), so we rely on the latent projection
    and positional encoding to provide the necessary context.
    """

    def __init__(
        self,
        n_channels: int,
        sequence_length: int,
        n_classes: int,
        d_model: int,
        n_attention_heads: int,
        n_layers: int,
        d_ff: int | None,
        latent_dim: int,
        condition_dim: int | None = None,
        dropout: float = 0.1,
    ):
        if d_model % n_attention_heads != 0:
            raise ValueError(
                f"d_model ({d_model}) must be divisible by n_attention_heads ({n_attention_heads})"
            )
        super().__init__()
        self.n_channels = n_channels
        self.sequence_length = sequence_length
        self.n_classes = n_classes
        self.d_model = d_model
        self.latent_dim = latent_dim
        self.condition_dim = condition_dim

        input_size = n_channels * n_classes
        d_ff = d_ff or (4 * d_model)

        # Input projection
        self.input_proj = nn.Linear(input_size, d_model)

        # Positional encoding
        self.pos_encoding = nn.Parameter(torch.randn(1, sequence_length, d_model) * 0.02)

        # Transformer encoder
        encoder_layer = nn.TransformerEncoderLayer(
            d_model=d_model,
            nhead=n_attention_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            batch_first=True,
        )
        self.transformer_encoder = nn.TransformerEncoder(encoder_layer, num_layers=n_layers)

        # Latent projection (mean pool over sequence)
        self.encoder_fc = nn.Linear(d_model, latent_dim)

        # Decoder projection
        # Decoder input: latent + condition (if provided)
        decoder_input_dim = latent_dim + (condition_dim or 0)
        self.decoder_fc = nn.Linear(decoder_input_dim, d_model * sequence_length)

        # Transformer decoder
        decoder_layer = nn.TransformerDecoderLayer(
            d_model=d_model,
            nhead=n_attention_heads,
            dim_feedforward=d_ff,
            dropout=dropout,
            batch_first=True,
        )
        self.transformer_decoder = nn.TransformerDecoder(decoder_layer, num_layers=n_layers)

        # Output projection
        self.output_proj = nn.Linear(d_model, input_size)

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Encode to latent space via attention."""
        batch_size = x.shape[0]
        # x: [batch, n_channels * sequence_length * n_classes]
        x = x.view(batch_size, self.n_channels, self.sequence_length, self.n_classes)
        # -> [batch, sequence_length, n_channels * n_classes]
        x = x.permute(0, 2, 1, 3).reshape(batch_size, self.sequence_length, -1)

        x = self.input_proj(x) + self.pos_encoding
        x = self.transformer_encoder(x)
        # Mean pool over sequence
        x = x.mean(dim=1)
        return self.encoder_fc(x)

    def decode(self, z: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        """Decode from latent via attention."""
        if self.condition_dim is not None:
            if condition is None:
                raise ValueError("Model requires condition vector but none provided")
            if condition.shape[1] != self.condition_dim:
                raise ValueError(f"Expected condition_dim={self.condition_dim}, got {condition.shape[1]}")
            z = torch.cat([z, condition], dim=1)
        elif condition is not None:
            raise ValueError("Model has no condition_dim but condition was provided")

        batch_size = z.shape[0]
        # Project and reshape to sequence
        x = self.decoder_fc(z)
        x = x.view(batch_size, self.sequence_length, self.d_model)

        # Use positional encoding as memory for cross-attention
        memory = x + self.pos_encoding
        x = self.transformer_decoder(x + self.pos_encoding, memory)
        x = self.output_proj(x)

        # -> [batch, sequence_length, n_channels, n_classes]
        x = x.view(batch_size, self.sequence_length, self.n_channels, self.n_classes)
        # -> [batch, n_channels, sequence_length, n_classes]
        x = x.permute(0, 2, 1, 3)
        return x.reshape(batch_size, -1)


class LightningMLP(pl.LightningModule):
    """Production-grade MLP/Autoencoder using PyTorch Lightning."""

    # The network: an ``nn.Sequential`` for ``mlp``, a ``_TemporalAutoencoder``
    # for the sequence architectures; ``autoencoder`` uses ``encoder`` / ``decoder``.
    net: nn.Module
    latent_dim: int | None
    group_weights_tensor: torch.Tensor | None
    class_weights: torch.Tensor | None

    def __init__(
        self,
        input_dim: int,
        output_dim: int,
        architecture_type: str,
        architecture_config: dict,
        output_type: str,
        output_config: dict,
        learning_rate: float = 1e-3,
        dropout: float = 0.1,
        weight_decay: float = 0.0,
        group_weights: dict | None = None,
    ):
        super().__init__()
        self.save_hyperparameters()

        self.input_dim = input_dim
        self.output_dim = output_dim
        self.architecture_type = architecture_type
        self.architecture_config = architecture_config
        self.output_type = output_type
        self.output_config = output_config
        self.learning_rate = learning_rate
        self.weight_decay = weight_decay

        # Extract condition_dim for temporal architectures
        self.condition_dim = architecture_config.get("condition_dim")

        # Validate temporal architecture config
        self._validate_temporal_config()

        # Group weights support
        self.use_group_weights = group_weights is not None
        self.group_weights_type = group_weights["weights_type"] if group_weights else None
        if group_weights is not None:
            self.register_buffer(
                "group_weights_tensor",
                torch.tensor(group_weights["weights"], dtype=torch.float32)
            )
        else:
            self.group_weights_tensor = None

        # Build network based on architecture
        if architecture_type == "autoencoder":
            encoder_layers = architecture_config["encoder_layers"]
            latent_dim = architecture_config["latent_dim"]
            decoder_layers = architecture_config["decoder_layers"]

            self.encoder = self._build_mlp(input_dim, encoder_layers, latent_dim, dropout)
            self.decoder = self._build_mlp(latent_dim, decoder_layers, output_dim, dropout)
            self.latent_dim = latent_dim
        elif architecture_type == "conv1d":
            n_classes = self._get_n_classes()
            self.net = Conv1DAutoencoder(
                n_channels=architecture_config["n_channels"],
                sequence_length=architecture_config["sequence_length"],
                n_classes=n_classes,
                conv_channels=architecture_config["conv_channels"],
                kernel_size=architecture_config["kernel_size"],
                latent_dim=architecture_config["latent_dim"],
                condition_dim=self.condition_dim,
                dropout=dropout,
            )
            self.latent_dim = architecture_config["latent_dim"]
        elif architecture_type == "sequential":
            n_classes = self._get_n_classes()
            cell_type = architecture_config["cell_type"]
            self.net = SequentialAutoencoder(
                n_channels=architecture_config["n_channels"],
                sequence_length=architecture_config["sequence_length"],
                n_classes=n_classes,
                hidden_size=architecture_config["hidden_size"],
                n_layers=architecture_config["n_layers"],
                cell_type=cell_type,
                latent_dim=architecture_config["latent_dim"],
                bidirectional=architecture_config.get("bidirectional", False),
                condition_dim=self.condition_dim,
                dropout=dropout,
            )
            self.latent_dim = architecture_config["latent_dim"]
        elif architecture_type == "transformer":
            n_classes = self._get_n_classes()
            self.net = TransformerAutoencoder(
                n_channels=architecture_config["n_channels"],
                sequence_length=architecture_config["sequence_length"],
                n_classes=n_classes,
                d_model=architecture_config["d_model"],
                n_attention_heads=architecture_config["n_attention_heads"],
                n_layers=architecture_config["n_layers"],
                d_ff=architecture_config.get("d_ff"),
                latent_dim=architecture_config["latent_dim"],
                condition_dim=self.condition_dim,
                dropout=dropout,
            )
            self.latent_dim = architecture_config["latent_dim"]
        else:  # mlp
            hidden_layers = architecture_config["hidden_layers"]
            self.net = self._build_mlp(input_dim, hidden_layers, output_dim, dropout)
            self.latent_dim = None

        # Store class weights as buffers if provided (only used when group_weights not provided)
        if output_type == "multi_head" and output_config.get("class_weights") is not None:
            self.register_buffer(
                "class_weights", torch.tensor(output_config["class_weights"], dtype=torch.float32)
            )
        else:
            self.class_weights = None

    def _get_n_classes(self) -> int:
        """Get number of classes per position for temporal architectures."""
        if self.output_type == "multi_head":
            return self.output_config["n_classes_per_head"]
        elif self.output_type == "binary":
            return 1
        elif self.output_type == "multiclass":
            return self.output_config["n_classes"]
        else:  # regression
            return 1

    def _validate_temporal_config(self):
        """Validate temporal architecture config matches output config."""
        if self.architecture_type not in ("conv1d", "sequential", "transformer"):
            return

        # Temporal architectures require multi_head or binary output
        if self.output_type not in ("multi_head", "binary"):
            raise ValueError(
                f"Temporal architecture '{self.architecture_type}' requires multi_head or binary output, "
                f"got '{self.output_type}'"
            )

        # Binary output: no additional validation needed here
        # (output_dim validation happens in forward pass)
        if self.output_type == "binary":
            return

        # n_heads must equal n_channels * sequence_length
        n_channels = self.architecture_config["n_channels"]
        sequence_length = self.architecture_config["sequence_length"]
        expected_heads = n_channels * sequence_length
        actual_heads = self.output_config["n_heads"]

        if actual_heads != expected_heads:
            raise ValueError(
                f"n_heads ({actual_heads}) must equal n_channels * sequence_length "
                f"({n_channels} * {sequence_length} = {expected_heads})"
            )

        # Conv1D-specific validation
        if self.architecture_type == "conv1d":
            conv_channels = self.architecture_config["conv_channels"]
            if not conv_channels:
                raise ValueError("conv_channels must not be empty")

            kernel_size = self.architecture_config["kernel_size"]
            if kernel_size < 1:
                raise ValueError(f"kernel_size must be >= 1, got {kernel_size}")
            if kernel_size % 2 == 0:
                raise ValueError(f"kernel_size must be odd for symmetric padding, got {kernel_size}")

        # Transformer-specific validation
        if self.architecture_type == "transformer":
            d_model = self.architecture_config["d_model"]
            n_attention_heads = self.architecture_config["n_attention_heads"]
            if d_model % n_attention_heads != 0:
                raise ValueError(
                    f"d_model ({d_model}) must be divisible by n_attention_heads ({n_attention_heads})"
                )

    def _build_mlp(
        self, input_dim: int, hidden_layers: list[int], output_dim: int, dropout: float
    ) -> nn.Sequential:
        """Build an MLP with LayerNorm and dropout."""
        layers = []
        prev_dim = input_dim

        for hidden_dim in hidden_layers:
            layers.extend(
                [
                    nn.Linear(prev_dim, hidden_dim),
                    nn.LayerNorm(hidden_dim),
                    nn.ReLU(),
                    nn.Dropout(dropout),
                ]
            )
            prev_dim = hidden_dim

        layers.append(nn.Linear(prev_dim, output_dim))
        return nn.Sequential(*layers)

    def _temporal_net(self) -> _TemporalAutoencoder | None:
        """The temporal network, or ``None`` for the mlp / autoencoder architectures."""
        net = getattr(self, "net", None)
        return net if isinstance(net, _TemporalAutoencoder) else None

    def forward(self, x: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        """Forward pass - returns raw logits."""
        if self.architecture_type == "autoencoder":
            return self.decoder(self.encoder(x))
        temporal = self._temporal_net()
        if temporal is not None:
            return temporal(x, condition)
        return self.net(x)

    def encode(self, x: torch.Tensor) -> torch.Tensor:
        """Encode input to latent space (autoencoder and temporal architectures)."""
        if self.architecture_type == "autoencoder":
            return self.encoder(x)
        temporal = self._temporal_net()
        if temporal is not None:
            return temporal.encode(x)
        raise ValueError(f"encode() not available for {self.architecture_type} architecture")

    def decode(self, z: torch.Tensor, condition: torch.Tensor | None = None) -> torch.Tensor:
        """Decode latent to output (autoencoder and temporal architectures)."""
        if self.architecture_type == "autoencoder":
            return self.decoder(z)
        temporal = self._temporal_net()
        if temporal is not None:
            return temporal.decode(z, condition)
        raise ValueError(f"decode() not available for {self.architecture_type} architecture")

    def training_step(self, batch, batch_idx):
        # Batch structure depends on features used:
        # Base: (x, y)
        # With masks: (x, y, masks)
        # With group_weights: (x, y, masks, group_idx)
        # With conditions: adds condition as last element
        x, y, masks, group_idx, condition = self._unpack_batch(batch)

        logits = self(x, condition)
        loss = self._compute_loss(logits, y, masks, group_idx)
        self.log("train_loss", loss, prog_bar=True)
        return loss

    def validation_step(self, batch, batch_idx):
        x, y, masks, group_idx, condition = self._unpack_batch(batch)

        logits = self(x, condition)
        loss = self._compute_loss(logits, y, masks, group_idx)
        self.log("val_loss", loss, prog_bar=True)
        return loss

    def _unpack_batch(self, batch):
        """Unpack batch based on what features are present."""
        # Batch structure:
        # (x, y) - basic
        # (x, y, masks) - with masks
        # (x, y, masks, group_idx) - with group_weights
        # (x, y, masks, group_idx, condition) - with conditions
        # Note: conditions require masks and group_idx slots (possibly None tensors)

        batch_len = len(batch)
        condition = None
        group_idx = None
        masks = None

        if batch_len == 2:
            x, y = batch
        elif batch_len == 3:
            x, y, masks = batch
        elif batch_len == 4:
            x, y, masks, group_idx = batch
        elif batch_len == 5:
            x, y, masks, group_idx, condition = batch
        else:
            raise ValueError(f"Unexpected batch length: {batch_len}")

        return x, y, masks, group_idx, condition

    def _compute_loss(
        self,
        logits: torch.Tensor,
        targets: torch.Tensor,
        masks: torch.Tensor | None = None,
        group_idx: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """Compute loss based on output type."""
        if self.output_type == "regression":
            return F.mse_loss(logits, targets)

        elif self.output_type == "binary":
            return self._binary_loss(logits, targets, masks, group_idx)

        elif self.output_type == "multiclass":
            class_weights = self.output_config.get("class_weights")
            if class_weights is not None:
                class_weights = torch.tensor(class_weights, dtype=torch.float32, device=logits.device)
            target_indices = targets.argmax(dim=-1)
            return F.cross_entropy(logits, target_indices, weight=class_weights)

        elif self.output_type == "multi_head":
            return self._multi_head_loss(logits, targets, masks, group_idx)

        else:
            raise ValueError(f"Unknown output type: {self.output_type}")

    def _binary_loss(
        self,
        logits: torch.Tensor,
        targets: torch.Tensor,
        masks: torch.Tensor | None = None,
        group_idx: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """Compute binary cross-entropy loss with optional group-based pos_weights."""
        if self.group_weights_tensor is not None and group_idx is not None:
            # Per-sample pos_weights from group lookup: [batch, output_dim]
            batch_pos_weights = self.group_weights_tensor[group_idx]

            # Compute BCE with per-sample weights
            loss = F.binary_cross_entropy_with_logits(
                logits, targets, reduction="none"
            )  # [batch, output_dim]

            # Weight positive samples: loss * (target * pos_weight + (1 - target))
            # This matches PyTorch's pos_weight behavior
            weighted_loss = loss * (targets * batch_pos_weights + (1 - targets))

            # Apply masks if provided
            if masks is not None:
                if masks.dim() == 3:
                    masks = masks.squeeze(1)  # [batch, 1, output_dim] -> [batch, output_dim]
                weighted_loss = weighted_loss * masks.float()
                n_valid = masks.sum()
                if n_valid > 0:
                    return weighted_loss.sum() / n_valid
                return weighted_loss.sum()

            return weighted_loss.mean()

        else:
            # Existing global pos_weight path
            pos_weight = self.output_config.get("pos_weight")
            if pos_weight is not None:
                pos_weight = torch.tensor(pos_weight, dtype=torch.float32, device=logits.device)

            loss = F.binary_cross_entropy_with_logits(
                logits, targets, pos_weight=pos_weight, reduction="none"
            )

            if masks is not None:
                if masks.dim() == 3:
                    masks = masks.squeeze(1)
                loss = loss * masks.float()
                n_valid = masks.sum()
                if n_valid > 0:
                    return loss.sum() / n_valid
                return loss.sum()

            return loss.mean()

    def _multi_head_loss(
        self,
        logits: torch.Tensor,
        targets: torch.Tensor,
        masks: torch.Tensor | None = None,
        group_idx: torch.Tensor | None = None,
    ) -> torch.Tensor:
        """Vectorized multi-head CE loss with group-based weights."""
        n_heads = self.output_config["n_heads"]
        n_classes = self.output_config["n_classes_per_head"]

        batch_size = logits.shape[0]
        logits = logits.view(batch_size, n_heads, n_classes)
        targets = targets.view(batch_size, n_heads, n_classes)
        target_indices = targets.argmax(dim=-1)  # [batch, n_heads]

        # Track which targets are valid (target position is unmasked)
        valid_targets = None
        if masks is not None:
            # masks: (batch, n_heads, n_classes) - True = valid
            # Check if the TARGET position is valid (not just any position)
            valid_targets = masks.gather(2, target_indices.unsqueeze(-1)).squeeze(-1)  # [batch, n_heads]
            logits = logits.masked_fill(~masks, float("-inf"))

        # Compute log softmax (vectorized across all heads)
        log_probs = F.log_softmax(logits, dim=-1)  # [batch, n_heads, n_classes]

        # Gather log probs for target classes
        nll = -log_probs.gather(2, target_indices.unsqueeze(-1)).squeeze(-1)  # [batch, n_heads]

        # Zero out loss where target is masked (would be inf)
        if valid_targets is not None:
            nll = nll.masked_fill(~valid_targets, 0.0)

        # Apply weights
        if self.group_weights_tensor is not None and group_idx is not None:
            # Look up weights for each sample's group: [batch, n_heads, n_classes]
            batch_weights = self.group_weights_tensor[group_idx]
            # Gather weights for target classes
            sample_weights = batch_weights.gather(2, target_indices.unsqueeze(-1)).squeeze(-1)  # [batch, n_heads]
            weighted_nll = nll * sample_weights

            # Average only over valid targets
            if valid_targets is not None:
                n_valid = valid_targets.sum()
                if n_valid > 0:
                    return weighted_nll.sum() / n_valid
                return torch.tensor(0.0, device=logits.device)
            return weighted_nll.mean()

        elif self.class_weights is not None:
            # Global weights (also vectorized)
            batch_size = target_indices.shape[0]
            expanded_weights = self.class_weights.unsqueeze(0).expand(batch_size, -1, -1)
            sample_weights = expanded_weights.gather(2, target_indices.unsqueeze(-1)).squeeze(-1)  # [batch, n_heads]
            weighted_nll = nll * sample_weights

            # Average only over valid targets
            if valid_targets is not None:
                n_valid = valid_targets.sum()
                if n_valid > 0:
                    return weighted_nll.sum() / n_valid
                return torch.tensor(0.0, device=logits.device)
            return weighted_nll.mean()

        else:
            # Average only over valid targets
            if valid_targets is not None:
                n_valid = valid_targets.sum()
                if n_valid > 0:
                    return nll.sum() / n_valid
                return torch.tensor(0.0, device=logits.device)
            return nll.mean()

    def configure_optimizers(self):
        return torch.optim.AdamW(
            self.parameters(), lr=self.learning_rate, weight_decay=self.weight_decay
        )

    def predict_probs(self, x: torch.Tensor) -> torch.Tensor:
        """Get output probabilities (applies appropriate activation)."""
        return self.predict_probs_with_masks(x, None)

    def apply_output_activation(self, logits: torch.Tensor) -> torch.Tensor:
        """Apply output activation to logits (without running forward pass).

        Used by decode() to convert decoder output to probabilities.
        """
        if self.output_type == "regression":
            return logits
        elif self.output_type == "binary":
            return torch.sigmoid(logits)
        elif self.output_type == "multiclass":
            return F.softmax(logits, dim=-1)
        elif self.output_type == "multi_head":
            n_heads = self.output_config["n_heads"]
            n_classes = self.output_config["n_classes_per_head"]
            batch_size = logits.shape[0]
            logits = logits.view(batch_size, n_heads, n_classes)
            probs = F.softmax(logits, dim=-1)
            return probs.view(batch_size, -1)
        else:
            return logits

    def predict_probs_with_masks(
        self, x: torch.Tensor, masks: torch.Tensor | None = None
    ) -> torch.Tensor:
        """Get output probabilities with optional masking for binary/multi-head outputs."""
        logits = self(x)

        if self.output_type == "regression":
            return logits
        elif self.output_type == "binary":
            probs = torch.sigmoid(logits)
            # Apply masks if provided: set masked positions to 0
            if masks is not None:
                if masks.dim() == 3:
                    masks = masks.squeeze(1)
                probs = probs * masks.float()
            return probs
        elif self.output_type == "multiclass":
            return F.softmax(logits, dim=-1)
        elif self.output_type == "multi_head":
            n_heads = self.output_config["n_heads"]
            n_classes = self.output_config["n_classes_per_head"]
            batch_size = logits.shape[0]
            logits = logits.view(batch_size, n_heads, n_classes)

            # Apply masks if provided: set masked positions to -inf before softmax
            if masks is not None:
                # masks: (batch, n_heads, n_classes) - True = valid
                logits = logits.masked_fill(~masks, float("-inf"))

            probs = F.softmax(logits, dim=-1)
            return probs.view(batch_size, -1)
        else:
            return logits

    def predict_probs_with_masks_conditional(
        self,
        x: torch.Tensor,
        masks: torch.Tensor | None,
        conditions: torch.Tensor,
    ) -> torch.Tensor:
        """Get output probabilities with conditions and optional masking."""
        temporal = self._temporal_net()
        if temporal is None:
            raise ValueError(f"Conditional predict not supported for {self.architecture_type}")

        logits = temporal(x, conditions)
        probs = self.apply_output_activation(logits)

        # Apply masks if provided
        if masks is not None:
            if self.output_type == "multi_head":
                n_heads = self.output_config["n_heads"]
                n_classes = self.output_config["n_classes_per_head"]
                batch_size = probs.shape[0]
                probs = probs.view(batch_size, n_heads, n_classes)
                probs = probs.masked_fill(~masks, 0.0)
                probs = probs.view(batch_size, -1)
            else:
                probs = probs * masks.float().view(probs.shape[0], -1)

        return probs

    def generate_autoregressive(
        self,
        prefix: torch.Tensor | None,
        condition: torch.Tensor | None,
        n_steps: int,
        temperature: float = 1.0,
        return_probs: bool = False,
    ) -> torch.Tensor:
        """Generate sequence autoregressively.

        Args:
            prefix: Optional prefix sequence (n_prefix_steps, n_channels) to continue from.
                   If None or empty, starts from zeros.
            condition: Optional condition vector (1, condition_dim) to condition generation.
            n_steps: Number of steps to generate.
            temperature: Sampling temperature. 0.0 = argmax, > 0 = scaled sampling.
            return_probs: If True, return probabilities. If False, return samples.

        Returns:
            Generated sequence (n_steps, n_channels) - does NOT include prefix.
        """
        net = self._temporal_net()
        if not isinstance(net, SequentialAutoencoder):
            raise ValueError(
                f"generate_autoregressive requires sequential architecture, got {self.architecture_type}"
            )

        if self.output_type not in ("binary", "regression"):
            raise ValueError(
                f"generate_autoregressive requires binary or regression output, got {self.output_type}"
            )

        n_channels = net.n_channels

        # Initialize hidden state
        hidden = net.init_hidden(batch_size=1)

        # Determine input size: n_channels (+ condition_dim if using conditions)
        input_size = n_channels
        if condition is not None and net.condition_dim:
            input_size += net.condition_dim

        # Process prefix to establish hidden state
        if prefix is not None and prefix.shape[0] > 0:
            # prefix: (n_prefix_steps, n_channels)
            prefix_seq = prefix.unsqueeze(0)  # (1, n_prefix_steps, n_channels)

            if condition is not None and net.condition_dim:
                # Concatenate condition to each prefix timestep
                cond_expanded = condition.expand(prefix.shape[0], -1)  # (n_prefix_steps, condition_dim)
                prefix_with_cond = torch.cat([prefix, cond_expanded], dim=-1)  # (n_prefix_steps, input_size)
                prefix_seq = prefix_with_cond.unsqueeze(0)  # (1, n_prefix_steps, input_size)

            _, hidden = net.decoder_rnn(prefix_seq, hidden)

        # Initial input for generation
        if prefix is not None and prefix.shape[0] > 0:
            x_t = prefix[-1:].clone()  # (1, n_channels) - last prefix step
        else:
            x_t = torch.zeros(1, n_channels, device=next(net.parameters()).device)

        # Autoregressive generation loop
        outputs = []
        for _ in range(n_steps):
            # Concatenate condition to input at each step
            if condition is not None and net.condition_dim:
                x_t_with_cond = torch.cat([x_t, condition], dim=-1).unsqueeze(1)  # (1, 1, input_size)
            else:
                x_t_with_cond = x_t.unsqueeze(1)  # (1, 1, n_channels)

            # Decoder step
            out_t, hidden = net.decoder_rnn(x_t_with_cond, hidden)
            logits_t = net.output_fc(out_t.squeeze(1))  # (1, n_channels)
            probs_t = self.apply_output_activation(logits_t)

            if return_probs:
                outputs.append(probs_t)
            else:
                # Sample or argmax
                if temperature > 0:
                    samples_t = self._sample_from_probs(probs_t, temperature)
                else:
                    samples_t = self._argmax_from_probs(probs_t)
                outputs.append(samples_t)
                x_t = samples_t  # Next input

        return torch.cat(outputs, dim=0)  # (n_steps, n_channels)

    def _sample_from_probs(self, probs: torch.Tensor, temperature: float) -> torch.Tensor:
        """Sample from probabilities with temperature scaling."""
        if self.output_type == "binary":
            # Scale logits by temperature, then sample
            # Avoid log(0) by clamping
            logits = torch.logit(probs.clamp(1e-7, 1 - 1e-7))
            scaled_probs = torch.sigmoid(logits / temperature)
            return torch.bernoulli(scaled_probs)
        else:
            # Regression: add scaled noise
            noise = torch.randn_like(probs) * temperature
            return probs + noise

    def _argmax_from_probs(self, probs: torch.Tensor) -> torch.Tensor:
        """Deterministic output from probabilities."""
        if self.output_type == "binary":
            return (probs > 0.5).float()
        else:
            return probs


# ============================================================================
# Serialization Helpers
# ============================================================================


def serialize_model(model: LightningMLP) -> bytes:
    """Serialize model state_dict + hyperparameters."""
    data = {
        "state_dict": model.state_dict(),
        "hparams": dict(model.hparams),
    }
    return pickle.dumps(data)


def deserialize_model(blob: bytes) -> LightningMLP:
    """Deserialize model from state_dict + hyperparameters."""
    data = pickle.loads(blob)
    hparams = data["hparams"]

    model = LightningMLP(
        input_dim=hparams["input_dim"],
        output_dim=hparams["output_dim"],
        architecture_type=hparams["architecture_type"],
        architecture_config=hparams["architecture_config"],
        output_type=hparams["output_type"],
        output_config=hparams["output_config"],
        learning_rate=hparams.get("learning_rate", 1e-3),
        dropout=hparams.get("dropout", 0.1),
        weight_decay=hparams.get("weight_decay", 0.0),
    )
    # Use strict=False to allow loading models trained with group_weights
    # (which have group_weights_tensor buffer) into models without it.
    # Group weights are training-only and not needed for inference.
    model.load_state_dict(data["state_dict"], strict=False)
    return model


__all__ = [
    "Conv1DAutoencoder",
    "EpochCallback",
    "LightningMLP",
    "SequentialAutoencoder",
    "TransformerAutoencoder",
    "deserialize_model",
    "serialize_model",
]
