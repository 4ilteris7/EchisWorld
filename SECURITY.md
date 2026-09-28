# Security policy

## Reporting a vulnerability

Do not report credentials, private infrastructure details, personal information, or exploitable vulnerabilities in a public issue.

For the public repository, use GitHub's private vulnerability reporting or security-advisory feature. Include a concise description, affected paths, reproduction steps, and the likely impact. Do not include real provider keys, database dumps, or unrelated personal data.

## Supported version

Until the first stable release, only the latest commit on the default branch is supported.

## Credential handling

- Real credentials belong only in ignored local environment files or the deployment secret store.
- Browser code must not receive server or worker credentials.
- Database dumps and generated local database passwords must never be committed.
- A suspected leaked credential must be revoked and rotated even if it is later removed from Git history.
