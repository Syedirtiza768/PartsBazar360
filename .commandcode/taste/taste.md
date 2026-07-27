# Taste (Continuously Learned by [CommandCode][cmd])

[cmd]: https://commandcode.ai/

# ui
- Use light theme (slate/white backgrounds with emerald and blue accents) instead of dark theme for seller, admin, and operations portal UIs. Confidence: 0.85
- Mobile-first responsive design is a top priority: every page, component, modal, form, table, and interactive state must work across all viewports (320px–1920px+). Confidence: 0.95
- Avoid generic AI-generated design patterns (excessive gradients, oversized cards, unnecessary glass effects). Prefer restrained, professional, cohesive design systems. Confidence: 0.85
- Filter dropdowns (e.g., vehicle make/model) must only show values that exist in the database — the database is the source of truth for all filter options across the application. Confidence: 0.9
- Wants the application compared against Shopify-level functionality and quality as a benchmark for completeness. Confidence: 0.8

# workflow
See [workflow/taste.md](workflow/taste.md)
# data
- When importing data, prefers completeness over curation — import everything and filter/translate in post-processing rather than skipping records at ingestion time. Willing to disable language or quality filters in code to get full dataset coverage. Confidence: 0.85
- Non-English content must be translated to English before publishing/going live — translation is a required pre-publish step, not an optional enhancement. Confidence: 0.9
- Make and Brand must be strictly separated: Make = vehicle manufacturer (Toyota, BMW) and belongs on every vehicle; Brand = parts manufacturer (FEBEST, Bosch) and is only relevant for aftermarket/OEM part attribution. Brand should never fall back to Make when unknown — leave it null instead. Confidence: 0.9

# communication
- Communicates in terse shorthand — minimal words, no punctuation, no full sentences (e.g., "check progress show titles"). Expects the assistant to interpret intent and run the right commands without asking clarifying questions. Confidence: 0.85

# cli
- Use `npx.cmd` instead of `npx` on Windows PowerShell to bypass execution policy restrictions. Confidence: 0.70

