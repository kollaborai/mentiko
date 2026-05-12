# Documentation Style Guide

Complete pattern analysis and template for Mentiko documentation.

---

## Overview

Mentiko docs follow a consistent, practical structure designed for developers and users who need clear, actionable information. The style is technical but accessible, with emphasis on examples, code blocks, and troubleshooting.

**Core Principles:**
- Practical over theoretical - show how to do things
- Code-heavy - examples for every concept
- Troubleshooting-focused - anticipate common issues
- Scannable - clear headers, tables, lists
- Version-aware - note when features were added

---

## Required Document Structure

Every documentation page MUST follow this structure:

### 1. Title (H1)

```markdown
# Page Title

Brief one-line description.
```

- First line is always H1 with the page title
- Second line is a brief, descriptive subtitle
- No blank line between title and subtitle
- One blank line after subtitle before first section

**Examples:**
```markdown
# Troubleshooting Guide

Common issues, error codes, and solutions.

# API Reference

Complete API documentation for the Agent Chain web interface.

# Analytics

privacy-first analytics supporting GA4 and Plausible.
```

### 2. Section Separator (Three Dashes)

After the subtitle, add a horizontal rule before the first major section:

```markdown
# Page Title

Brief description.

---

## First Section
```

### 3. Major Sections (H2)

Use H2 (`##`) for major sections. Capitalize first letter only (sentence case):

```markdown
## Authentication

## Chain Issues

## Environment Variables
```

### 4. Subsections (H3)

Use H3 (`###`) for subsections within major sections:

```markdown
## Chain Issues

### "Failed to generate chain"

### "Invalid chain" (Validation errors)
```

### 5. Sub-subsections (H4+)

Rarely needed, but use H4 (`####`) if you must go deeper:

```markdown
## Deployment

### Vercel (Recommended)

#### Using Environment Variables
```

---

## Common Section Patterns

### For Feature/Component Documentation

Use this pattern for documenting specific features:

```markdown
## Feature Name

Brief description of what this feature does.

### Overview

High-level explanation of the feature's purpose and benefits.

### Setup

Step-by-step setup instructions.

### Usage

How to use the feature in practice.

### Configuration

Available configuration options.

### Examples

Real-world usage examples.

### Troubleshooting

Common issues and solutions.
```

### For API Documentation

Use this pattern for API endpoints:

```markdown
## Resource Name

### List Resources

```http
GET /api/resource/list
```

**Response:**
```json
{
  "items": [...]
}
```

### Get Resource

```http
GET /api/resource/[id]
```

**Response:**
```json
{...}
```

### Create Resource

```http
POST /api/resource/create
Content-Type: application/json
```

**Request:**
```json
{...}
```

**Response:**
```json
{...}
```
```

### For Troubleshooting Documentation

Use this pattern for troubleshooting guides:

```markdown
## Issue Category

### "Error Message"

**Symptoms:**
- Symptom 1
- Symptom 2

**Causes & Solutions:**

1. **Cause name**
   ```bash
   # Diagnostic command
   command_here

   # Explanation
   ```

2. **Another cause**
   - Text explanation
   - Link to related docs
```

---

## Formatting Standards

### Code Blocks

Always specify language for syntax highlighting:

```markdown
\`\`\`bash
# shell commands
curl http://localhost:3000/api/health
\`\`\`

\`\`\`typescript
// typescript code
interface Chain {
  name: string;
}
\`\`\`

\`\`\`json
{
  "key": "value"
}
\`\`\`

\`\`\`nginx
# nginx config
server { ... }
\`\`\`

\`\`\`yaml
# yaml config
services:
  web:
    build: .
\`\`\`
```

**Inline code:**
Use backticks for:
- File paths: `/opt/mentiko/chains/`
- Environment variables: `BETTER_AUTH_SECRET`
- Configuration keys: `max_rounds`
- Commands: `npm run dev`
- API endpoints: `/api/chains/list`

### Lists

**Bulleted lists:**
- Use hyphens (`-`)
- No blank lines between items
- Second line indent with 2 spaces

```markdown
- Quick Actions - Create chain, browse templates
- Active Chains - Your configured chains
- Recent Runs - Latest executions
```

**Numbered lists:**
Use numbered lists for sequential steps:

```markdown
1. Click **Chains** -> **Create Chain**
2. Choose an example prompt
3. Configure options (optional)
4. Click **Generate Chain**
```

**Nested lists:**
Indent with 2 spaces:

```markdown
1. First step
   - Sub-item a
   - Sub-item b
2. Second step
```

### Tables

Use GitHub-flavored markdown tables:

```markdown
| Environment | Log Location |
|-------------|--------------|
| Local dev | Console output |
| Docker | `docker logs mentiko` |
| Systemd | `journalctl -u mentiko` |
```

- Left-align columns by default
- Right-align numbers if needed
- Keep tables narrow enough to read

### Emphasis

- **Bold**: Use for UI elements, button names, key terms
  - `**Create Chain**` button
  - `**Symptoms:**` section header

- *Italic*: Rarely used. Only for:
  - Introducing terms: `The *run* is the execution instance`
  - Very light emphasis

- `Code`: Use backticks for all code references

### Links

```markdown
- GitHub Issues: https://github.com/your-org/mentiko/issues
- Documentation: https://docs.mentiko.dev
- Related: See [API Reference](./api-reference.md)
```

- Use absolute URLs for external links
- Use relative paths for internal docs links: `./page-name.md`
- Write links as: `[Text](url)` format

### Notes, Warnings, Tips

Use inline formatting with emoji prefix (optional, for visibility):

```markdown
**Note:** Sessions expire after 7 days.

**Warning:** Never commit `.env` files.

**Tip:** Use debug mode for detailed logs.
```

---

## Writing Style

### Tone

- **Direct**: "Click **Chains** -> **Create Chain**" not "You should click..."
- **Action-oriented**: Start with verbs
- **Concise**: Short sentences, no fluff
- **Practical**: Focus on how-to, not theory

### Voice

- Second person ("you") is fine for user guides
- Imperative mood for commands: "Run this command"
- Present tense: "The chain validates agents"
- Avoid: "I would recommend", "It's important to note"

### Terminology

Consistent term usage:

| Term | Usage |
|------|-------|
| chain | Always lowercase, not "Chain" |
| agent | Always lowercase |
| run | Always lowercase (noun: "a run", verb: "to run") |
| namespace | Lowercase |
| workspace | Lowercase |
| CLI | Uppercase |
| API | Uppercase |
| SSE | Uppercase |
| webhook | One word, lowercase |

### Sentence Structure

- Short sentences (15-20 words max)
- Active voice: "The agent emits an event" not "An event is emitted by the agent"
- Simple words: "Use" not "Utilize"
- No jargon without explanation

---

## Code Examples

### Shell Commands

```markdown
\`\`\`bash
# Comment explaining what this does
command_here

# Another comment
another_command
\`\`\`
```

Rules:
- Add comments with `#` for complex commands
- Show output below command if helpful
- Include expected response for API calls

### Configuration Files

Always show complete, working examples:

```markdown
\`\`\`bash
# .env
BETTER_AUTH_SECRET=your-random-secret-here
ANTHROPIC_API_KEY=sk-ant-...
\`\`\`
```

### JSON/YAML Examples

- Show complete objects
- Include comments in markdown, not inside JSON
- Use real values, not placeholders (use realistic examples)

**Good:**
```markdown
\`\`\`json
{
  "agents": [
    {
      "id": "researcher",
      "name": "Researcher",
      "triggers": ["manual-start"]
    }
  ]
}
\`\`\`
```

**Bad:**
```markdown
\`\`\`json
{
  "key": "value",
  "data": {...}
}
\`\`\`
```

---

## Page Types

### User Guide

Purpose: How to use features

Structure:
1. Feature overview
2. Step-by-step instructions
3. Screenshots/references (optional)
4. Tips and best practices

Example: `user-guide.md`

### API Reference

Purpose: Complete API documentation

Structure:
1. Authentication
2. Endpoints grouped by resource
3. Request/response examples
4. Error codes

Example: `api-reference.md`

### Troubleshooting Guide

Purpose: Diagnose and fix issues

Structure:
1. Quick diagnosis
2. Issues grouped by category
3. Symptoms → Causes → Solutions
4. Getting help section

Example: `troubleshooting.md`

### Technical Guide

Purpose: Deep technical details

Structure:
1. Overview
2. Architecture/concepts
3. Implementation details
4. Configuration options
5. Examples

Example: `deployment.md`, `ANALYTICS.md`

---

## Common Patterns

### Feature Documentation Template

```markdown
# Feature Name

Brief description.

---

## Overview

What this feature does and why it's useful.

## Setup

Step-by-step setup instructions.

## Usage

How to use the feature.

### Basic Usage

Simple example.

### Advanced Usage

Complex example with options.

## Configuration

Available options and what they do.

| Option | Type | Default | Description |
|--------|------|---------|-------------|
| optionName | string | "default" | Description |

## Troubleshooting

Common issues and solutions.

### "Issue name"

**Cause:** What causes it

**Solution:** How to fix it
\`\`\`bash
command_to_fix
\`\`\`
```

### API Endpoint Template

```markdown
### Endpoint Name

\`\`\`http
METHOD /api/endpoint
\`\`\`

**Description:** What this endpoint does

**Query Parameters:**
- `param1` (optional) - Description
- `param2` (required) - Description

**Request:**
\`\`\`json
{
  "field": "value"
}
\`\`\`

**Response:**
\`\`\`json
{
  "result": "..."
}
\`\`\`

**Error Responses:**
- `400` - Bad request
- `401` - Unauthorized
```

### Troubleshooting Section Template

```markdown
## Issue Category

### "Error message or symptom"

**Symptoms:**
- What the user sees
- Error messages
- Unexpected behavior

**Causes & Solutions:**

1. **Cause name**
   \`\`\`bash
   # Diagnostic command
   command_here

   # Explanation or next step
   \`\`\`

2. **Another cause**
   - Text explanation
   - Link to related docs
   - Fix steps
```

---

## Best Practices

### DO:

- Start every page with a clear, one-line description
- Use code examples for every concept
- Include troubleshooting sections
- Cross-reference related docs
- Use consistent terminology
- Show complete, working examples
- Add comments to code blocks
- Group related information under clear headings

### DON'T:

- Use walls of text - break into sections
- Assume prior knowledge - explain terms
- Use placeholders in examples - use realistic values
- Write overly technical explanations without examples
- Mix British and American English spelling
- Use excessive emphasis (bold/italic everything)
- Write vague descriptions like "Configure the settings"
- Skip edge cases and error handling

---

## File Naming

- Use lowercase with hyphens: `api-reference.md`, `troubleshooting.md`
- Use descriptive names: `deployment.md` not `deploy.md`
- Match page title: `user-guide.md` -> "User Guide"

---

## Review Checklist

Before submitting documentation:

- [ ] H1 title + one-line subtitle
- [ ] Three-dash separator after subtitle
- [ ] All H2s use sentence case
- [ ] Code blocks have language specified
- [ ] All code examples are complete and realistic
- [ ] Tables are properly formatted
- [ ] Links work (internal and external)
- [ ] Consistent terminology throughout
- [ ] Troubleshooting section included (if applicable)
- [ ] Cross-references to related docs
- [ ] No walls of text - broken into sections
- [ ] Practical examples for every concept
- [ ] Typos and grammar checked

---

## Examples in This Codebase

Reference these existing docs for patterns:

- `user-guide.md` - Feature documentation with step-by-step guides
- `api-reference.md` - Complete API documentation
- `troubleshooting.md` - Troubleshooting structure
- `deployment.md` - Technical guide with code examples
- `ANALYTICS.md` - Feature documentation (lowercase, concise style)
