# Parsed Document Artifacts

This directory stores runtime document parser artifacts generated during graph ingestion.

Each parsed document is written under:

```text
parsed_documents/{doc_id}/
  manifest.json
  content.md
  blocks.json
  chunks.jsonl
  structured_chunks.jsonl
  document_profile.json
  extraction_schema.json
  extraction_plan.json
  raw.json or raw.txt
```

The artifacts are for local inspection, parser quality review, and production troubleshooting. Runtime outputs in this directory are ignored by git.
