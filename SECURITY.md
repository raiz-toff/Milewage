# Security policy

## Supported versions

| Version | Supported |
| ------- | --------- |
| 0.1.x   | Yes       |

Fixes go into a new 0.1 patch release. Older versions do not exist yet.

## How to report a problem

Open a confidential issue on the project's GitLab. The public address is not decided yet, so:

**[The owner fills in the address here.]**

Please do not post details in a public place. Say what you found, how to repeat it, and which
version you ran. Do not include real location history or passwords.

## What is in scope

- The server (the API, the database, backups and restore).
- The web app.
- The Android phone app.
- The Docker images and the compose files in `infra/`.

Out of scope: Tailscale, Docker, Android itself, and OpenFreeMap. Report those to their own
projects.

## The threat model in short

- One owner. There is one account per server, and MileWage does not support several drivers.
- The server is meant to be reached over your Tailscale network, not the public internet. Nothing
  here is built or tested for public exposure.
- A phone holds an opaque device token. It can send data and read the last 14 days. It cannot
  export or download backups. You can revoke it on the web Devices page.
- Web sessions are opaque cookies stored on the server, so signing out or revoking works at once.
- Backups are encrypted with age. The recovery key is shown once and the server never stores it.
- Diagnostics stay on your server and never carry coordinates, addresses or free text.

## What you can expect

- We will acknowledge your report.
- A confirmed fix ships in a patch release, with a note in `CHANGELOG.md`.
- You will be credited if you want to be. Tell us how you would like to be named.

This is a one-person project and has not had an outside security review. No response times are
promised.
