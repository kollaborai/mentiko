# Knowledge Base Schema

This schema defines the structure for kdex knowledge base articles.

## Required Fields

- **title**: Human-readable article title
- **summary**: One-paragraph summary of the content
- **source**: Original file path or reference
- **topics**: Comma-separated list of topics/tags
- **content**: The full article body

## Optional Fields

- **related**: Links to related articles (comma-separated article IDs)
- **updated**: Last updated timestamp (auto-managed)
- **confidence**: Confidence score (0-1) for AI-generated summaries

## Article Format

Articles are stored as markdown files in the articles/ directory.
Each article file follows this frontmatter structure:

```
---
title: Article Title
summary: Brief summary here
source: /path/to/original/file
topics: topic1, topic2, topic3
---

Article content goes here.
```

## Index Structure

The index.md file tracks all articles and their metadata in a
machine-readable format at the top, followed by a human-readable listing.
