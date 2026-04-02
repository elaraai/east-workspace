# e3 Demo

A simple demo package showing e3's diamond dependency dataflow execution on the cloud platform.

## Package Structure

```
inputs.x (default: 10)
inputs.y (default: 5)
       |
   +---+---+
   |       |
  add     mul
(x + y)  (x * y)
   |       |
   +---+---+
       |
    combine
  (add + mul)
       |
    format
 ("Result: N")
```

With defaults: `add=15`, `mul=50`, `combine=65`, `format="Result: 65"`

## Usage

```bash
# Install dependencies (first time only)
npm install

# Deploy to dev.e3.elaraai.com
make deploy

# View results
make results

# Check workspace status
make status
```

## Exploring with CLI

After deployment, you can explore the demo with the e3 CLI:

```bash
# List workspaces
e3 list https://dev.e3.elaraai.com/repos/demo

# View workspace status
e3 workspace status https://dev.e3.elaraai.com/repos/demo dev

# Get task outputs
e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.format.output
e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.combine.output
e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.add.output
e3 get https://dev.e3.elaraai.com/repos/demo dev.tasks.mul.output

# Get inputs
e3 get https://dev.e3.elaraai.com/repos/demo dev.inputs.x
e3 get https://dev.e3.elaraai.com/repos/demo dev.inputs.y

# Modify an input and re-run
e3 set https://dev.e3.elaraai.com/repos/demo dev.inputs.x value.east  # where value.east contains e.g. "20"
e3 start https://dev.e3.elaraai.com/repos/demo dev
```
