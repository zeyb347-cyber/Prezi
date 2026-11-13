---
name: Discord integration boundaries
description: Distinguishes Replit's Discord user OAuth connection from bot authentication and moderation access.
---

The connected Discord integration is user OAuth for identity and guild membership. It cannot power a Gateway bot or bot-only moderation endpoints. A real moderation bot needs its own Discord application, its bot token stored in Replit Secrets, and a running Gateway client.

**Why:** The Replit connector's OAuth token is not a Discord bot token; Discord requires bot authentication for guild moderation and message operations.

**How to apply:** For Discord moderation features, use the connected integration only for user-scoped needs. Use a separately authorized bot application for server actions, and never expose its token in chat, logs, or browser code.
