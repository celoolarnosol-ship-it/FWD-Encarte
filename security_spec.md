# Security Specification for Firestore

## Data Invariants
- A profile belongs to a specific user and only that user can edit it.
- A chat belongs to a specific user.
- A message must belong to a valid chat, and the user must be the owner of that chat.
- Admin configuration can only be modified by users with the 'admin' role.

## The Dirty Dozen Payloads (Designed to Break the Rules)
1. **Identity Spoofing**: User A attempts to create a profile with `id: UserB`.
2. **Privilege Escalation**: User A attempts to update their profile with `role: 'admin'`.
3. **Orphaned Message**: User A attempts to create a message in a `chat_id` that doesn't exist.
4. **Chat Hijacking**: User A attempts to read or write messages to a chat owned by User B.
5. **Admin Config Poisoning**: Non-admin user attempts to change the `system_prompt`.
6. **State Shortcutting**: User A attempts to update a chat's `updated_at` to a past date.
7. **Resource Poisoning**: User A attempts to inject a 1MB string into a `display_name` field.
8. **Shadow Update**: User A attempts to update a profile and add an undocumented field `isVerified: true`.
9. **Email Spoofing**: User A attempts to create a profile using User B's email.
10. **Terminal State Lock Bypass**: (If applicable) Attempting to change an immutable field like `created_at`.
11. **PII Blanket Test**: User A attempts to list all user profiles and their private info.
12. **Denial of Wallet**: Attempting to create documents with extremely long random IDs.

## Test Runner (firestore.rules.test.ts)
(Implementation of these tests in a separate file or using tools)
