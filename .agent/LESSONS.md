# Lessons

Read this before every run, right after `CLAUDE.md`. Each lesson pairs a recurring failure with the
rule that prevents it. Agents never edit this file directly. Failed runs draft lessons in the
🤖 Agent Run Log, and the weekly digest proposes additions in a PR that the owner merges.

## Format

```
### L-NNN: <short imperative title>
- Seen in: #<issue>, #<PR> (YYYY-MM-DD)
- What went wrong: <one or two sentences>
- Rule: <what to do instead, stated so it can be followed mechanically>
- Enforced by: <test / lint rule / hook / CI check, or "prose only">
```

Prefer lessons that can become enforced checks. When a lesson gains enforcement, update its
"Enforced by" line.

## Lessons

_None yet._
