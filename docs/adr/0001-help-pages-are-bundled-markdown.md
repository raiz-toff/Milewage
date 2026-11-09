# Help pages are Markdown in docs/help, bundled into the web build

The owner wants driver documentation inside the web app, describing the version the driver runs, updating by itself on upgrade without fetching anything, and still readable on GitHub from one source (2026-11-09). We keep each Help page as a GitHub-flavoured Markdown file in `docs/help/` and import the folder into the web app at build time (Vite `import.meta.glob` with `?raw`), together with the running version's section of `CHANGELOG.md` as "What's new"; the web build is the version, so a new image brings new pages and no docs site or network fetch exists.

## Considered options

- **A docs site** (Docusaurus, VitePress, or GitHub Pages) linked from the app: a second deployment and a second look, and it shows the latest docs rather than the installed version.
- **Fetching the Markdown at run time** from the server or GitHub: ruled out by the owner ("no network fetch") and breaks offline reading.
- **Keeping the guides flat in `docs/`**: a non-recursive glob would skip `docs/adr/`, but any developer note later put in `docs/` would appear in drivers' sidebars. The folder is the contract: everything in `docs/help/*.md` except `README.md` is a page drivers read.
- **Rendering to an HTML string** (marked or markdown-it plus a sanitizer): makes a sanitizer the security boundary; React elements from `react-markdown` keep the strict CSP and need no `dangerouslySetInnerHTML`.

## Consequences

- The pages are a content contract checked by a test in `verify`: frontmatter `summary`, `group`, `order` and optional `module`; one `#` title; GitHub's dialect (GFM); no raw HTML, no images, no links to app paths such as `/privacy` (they break on GitHub). Links to other repository files open on GitHub at the tag `v<version>`.
- Heading anchors use GitHub's slug algorithm, so `#anchors` work the same in the app and on GitHub.
- GitHub shows each page's frontmatter as a small table above the text. Accepted.
- `docs/help/README.md` is the GitHub index and must list exactly the bundled pages; the same test enforces it.
- A version bump without a `CHANGELOG.md` section for it fails `verify`.
- The Docker web build needs `docs/` and `CHANGELOG.md` in its context; `.dockerignore` must not exclude them.
- Help is signed-in only and makes no request of its own except reading the server's version, to warn when it differs from the pages' version. No search, feedback, analytics or AI.
