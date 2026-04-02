/**
 * Copyright (c) 2025 Elara AI Pty Ltd. All rights reserved.
 * Proprietary and confidential.
 */

import { useState } from 'react';
import { HStack, Text, IconButton } from '@chakra-ui/react';
import { FiCopy, FiCheck } from 'react-icons/fi';

interface CopyablePathProps {
  /** The path to display */
  path: string;
  /** The full string to copy (e.g. workspace + path) */
  copyValue: string;
}

export function CopyablePath({ path, copyValue }: CopyablePathProps) {
  const [copied, setCopied] = useState(false);

  const handleCopy = () => {
    navigator.clipboard.writeText(copyValue);
    setCopied(true);
    setTimeout(() => setCopied(false), 1500);
  };

  return (
    <HStack gap={1}>
      <Text fontSize="sm" fontFamily="mono" color="text.primary">
        {path}
      </Text>
      <IconButton
        aria-label="Copy path"
        size="2xs"
        variant="ghost"
        color={copied ? 'green.500' : 'text.tertiary'}
        _hover={{ color: copied ? 'green.500' : 'text.primary' }}
        onClick={handleCopy}
      >
        {copied ? <FiCheck size={12} /> : <FiCopy size={12} />}
      </IconButton>
    </HStack>
  );
}
