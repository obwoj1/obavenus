# Study workspace parity

Obavenus is an original desktop product. This plan uses the visible Talvra workflow at `hwrk.help` as a feature reference; it does not copy Talvra's source, assets, or private service endpoints.

## Capabilities observed

- A study dashboard with due-soon, overdue, review, and today's-plan summaries.
- Course spaces containing modules, files, assignments, and course-specific study materials.
- Assignment pages that summarize instructions, requirements, grading criteria, skills, questions for the instructor, related documents, and a step plan.
- An AI homework workspace that creates and refines a draft, attaches deliverable files, and supports review before the student submits it themselves.
- Search across course documents with page-level references, plus a question-and-answer mode grounded in those documents.
- Study aids made from course files: notes, flashcards, and quizzes, followed by a spaced-review queue.
- Due-date reminders, quiet hours, a daily digest, and a study plan.
- An MCP endpoint for using study material from compatible AI clients, with a user-controlled hand-in boundary.

## Existing Obavenus building blocks

Obavenus already reads PDF, Word, Excel, and PowerPoint text locally, OCRs scanned PDFs, keeps encrypted per-project memory and conversation history, streams selected-provider responses, schedules local agent work, creates Office artifacts, and exposes an MCP-like tool workflow internally. These are reusable foundations, not proof that the study features below are complete.

## Implementation order

1. Build an optional local Study space: courses, assignments and due dates, checklists, notes, imported study files, and local search. Keep state encrypted and files on this Mac.
2. Add study-aid workflows over selected local files: explain with citations to page/slide, make notes, generate and edit flashcards, quiz mode, and a spaced-review queue. Use the configured provider or local Ollama; keep source references with generated content.
3. Add assignment support: requirement extraction, a student-editable plan and draft, artifact generation, and a review checklist. Do not submit work automatically.
4. Add optional external integrations with clear scopes and per-connection controls: Canvas, compatible MCP services such as Cengage where the school exposes a supported connector, then email reminders/digests.

## Current status

Obavenus now has an encrypted local Study interface for courses, assignments with checklist steps and due dates, notes, flashcard decks, deterministic spaced review, and multiple-choice practice quizzes. Canvas can be connected with a personal access token encrypted using the operating-system credential store; sync imports active courses, assignments, and Canvas module/item metadata, updating matching records. Course files can be imported for local text extraction (including PDF page labels, Office documents, and OCR) and searched with deterministic term ranking; a user-selected passage can be attached to a chat. Remote MCP services can be connected with an optional bearer token; read-only-annotated server tools are made available to the assistant over Streamable HTTP, with compatibility for the previous session-based protocol. Canvas submission and mutating MCP tools are not exposed. Imported files can produce an extractive local outline and deterministic flashcards. Canvas file-content downloads, richer assignment analysis, reminders, and email digests remain to be built. Assistant Markdown rendering is in place as a foundation for readable cited answers and structured drafts.
