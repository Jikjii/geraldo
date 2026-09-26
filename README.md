# Light-wall portfolio

A one-page portfolio: a sidebar with your name, bio and links, next to a living
wall of warm light tiles. Opening a page switches its tiles off, one jagged
column at a time, to reveal the text underneath. Every page can have its own
palette.

Plain HTML, CSS and JavaScript. No framework, no build step, no dependencies.

Design inspired by [shreygups.com](https://shreygups.com). This is an original
implementation; none of that site's code, fonts, audio or writing is included.

## Files

| File | What it is |
|---|---|
| `content.js` | **Everything you edit**: name, bio, pages, links, palettes, sound, the Manifesto's settings. |
| `manifesto.js` | The text of the Manifesto (Markdown). Loaded only when someone opens it. |
| `index.html` | The page shell: the site's folder (`<base href>`), meta tags for link previews, fonts, the no-JavaScript fallback. |
| `404.html` | An exact copy of `index.html` (the deep-link fallback on GitHub Pages). |
| `.nojekyll` | Empty. Tells GitHub Pages to serve the files as they are, without Jekyll. |
| `.gitignore` | Keeps local tool settings (`.claude/`) and macOS `.DS_Store` files out of the repository. |
| `assets/site.css` | Styles. The typeface and colours are variables at the top. |
| `assets/site.js` | The engine: light wall, panes, routing, sound. |
| `assets/manifesto.js`, `assets/manifesto.css` | The Manifesto's full-screen sequence, collage and reading page. Loaded on first open. |
| `assets/manifesto/opening.jpg` | The Manifesto's opening image (see [Manifesto](#manifesto) for its rights). |
| `assets/favicon.svg` | Static icon. While the tab is visible, the live icon follows the wall's colour. |
| `assets/og.png` | The 1200x630 link-preview image. Regenerate it with `tools/make-og.mjs`. |
| `tools/make-og.mjs` | Draws `assets/og.png` from your palette. |
| `dev.mjs` | Local preview server. |
| `vercel.json`, `_redirects` | Hosting rules for Vercel and Netlify, so addresses like `/work/company-one` work there. They only apply when the site sits at the root of a domain on those hosts; GitHub Pages ignores them. |

## Edit your content

Open `content.js`. Every field has a comment, and the example pages explain
themselves.

- **`name`, `bio`, `description`, `email`, `url`**: who you are. `url` is your
  site's public address, including its folder if it has one, with no trailing
  slash (for example `https://jikjii.github.io/geraldo`).
- **`work`**: the first list in the sidebar. Each item becomes a page at
  `/work/<slug>`, with a `title`, a `slug`, a `palette` and a Markdown `body`
  (plus an optional `description` for search engines). `workTitle` names the
  list for screen readers (default "Work").
- **`projects`**: one "Projects" link that opens a list, with a page for each
  project at `/projects/<slug>`. Give a project `url: "https://..."` and no
  `body` to link straight out instead. `projectsTitle` renames the link;
  `projectsIntro` (Markdown above the list), `projectsPalette` and
  `projectsDescription` are optional.
- **`groups`**: more lists that work like Projects (for example "Writing"),
  each with a `title`, `slug` and `items`, and optionally an `intro`, a
  `palette` and a `description`.
- **`social`**: the links at the bottom of the sidebar. The Email button, which
  copies your address, comes after them.

Page bodies are Markdown inside backticks, so they can span several lines:

```js
body: `
  A first paragraph with a [link](https://example.com), *italics* and **bold**.

  - A bullet
  - Another

  > A quote.
`,
```

Supported: paragraphs, links, `*italics*`, `**bold**`, `` `code` ``,
`# headings`, bullet and numbered lists, `> quotes`, `---` rules and
`![images](/assets/photo.jpg)`. HTML is shown as plain text, never run.
Links to your own pages (`[my projects](/projects)`) open as panes, in the
same place the sidebar would open them; other sites open in a new tab.

Addresses that start with `/` (in bodies, the bio, link `url`s and
`sound.src`) are relative to **the site's folder**, not the domain. Write
`/projects` and `/assets/photo.jpg`; on `https://jikjii.github.io/geraldo/`
they become `/geraldo/projects` and `/geraldo/assets/photo.jpg`, and the
same `content.js` keeps working at the root of a domain or opened from disk.
Full addresses (`https://...`) are used exactly as written.

**Match the file name's letter case exactly.** GitHub Pages treats
`/assets/Photo.JPG` and `/assets/photo.jpg` as different files, even though
your Mac or PC may not. `dev.mjs` is just as strict, so a wrong spelling
shows up as a missing image in the preview too.

**Escape backticks and `${` inside a body.** The body is itself wrapped in
backticks, so a bare backtick ends it early and `${` starts a JavaScript
placeholder. Either one stops the whole site from loading (the sidebar then
says "content.js failed to load"). Put a backslash in front: write `` \` `` for a backtick, so inline code looks like
`` \`code\` ``, and `\${` for `${`.

Also update the few placeholders in `index.html` that link previews read
(title, description, the site address in the canonical link, `og:url`,
`og:image` and `twitter:image`, the no-JavaScript fallback), and check the
`<base href>` at the top of its `<head>` (see
[Deploy](#deploying-to-github-pages-under-a-sub-folder)). Then copy it over
the 404 page:

```sh
cp index.html 404.html
```

## Manifesto

The first link under the bio, **Manifesto**, opens a full-screen page at
`/manifesto` (on GitHub Pages, `https://jikjii.github.io/geraldo/manifesto`)
instead of a pane:

1. **The opening** (about 4.5 seconds): black, then the opening image flickers
   on like an old monitor warming up, with green data streams sweeping across
   it and terminal lines typing out underneath. A glitch, then a hard cut.
2. **The title card** (about 3.5 seconds): the title cuts in line by line,
   like the opening card of a Neon Genesis Evangelion episode.
3. **The page**: a dense typographic collage built from the manifesto's own
   ideas (in English and Japanese), then just the manifesto: its title and
   subtitle centred on a screen of their own, the text in one centred
   column, and at the end **RETURN** and **REPLAY**.

A click, a tap, Space or Enter skips ahead; **REPLAY** plays the opening
again; **CLOSE ×**, Esc, **RETURN** or the browser's Back button return to
wherever the visitor was, with any open panes still open. With "reduce
motion" turned on, the page opens straight on the collage and REPLAY plays a
calm version (fades only).

Nothing of this loads until someone opens it: the code, the text and the
three typefaces ([Shippori Mincho B1](https://fonts.google.com/specimen/Shippori+Mincho+B1),
[Archivo](https://fonts.google.com/specimen/Archivo) and
[IBM Plex Mono](https://fonts.google.com/specimen/IBM+Plex+Mono), from Google
Fonts) are fetched on the first open.

**The text** lives in `manifesto.js`, as Markdown inside backticks, just like
a page body:

- The first `# heading` is the title. An `*italic*` line right under it is
  the subtitle; while the Manifesto is open it is also the page's
  description (the browser tab and the page's meta tags). Link previews and
  search engines don't run the site's JavaScript: they read the fixed tags
  at the top of `index.html`, which describe the home page, so a shared
  `/manifesto` link previews as the home page, if at all.
- Paragraphs, `[links](https://...)` (they open in a new tab), `*italics*` and
  `**bold**` work as everywhere else, and the text is shown exactly as
  written.
- **The same escaping rule applies**: the text is wrapped in backticks, so
  write `` \` `` for a backtick and `\${` for `${` (and `\\` for a
  backslash). An unescaped one stops the Manifesto from opening (the page
  then says it could not be loaded, and the browser console says why).

**The settings** are in `content.js`, under `manifesto`:

```js
manifesto: {
  label: "Manifesto",                        // the link, the tab title
  image: "/assets/manifesto/opening.jpg",    // the opening image
  terminal: [                                // the green lines typed under it
    "> SUBJECT: EXISTING PERSON",
    "> PROCEDURE: PROGRESSIVE INCORPORATION",
    "> CONTINUITY: UNVERIFIED",
  ],
  titleCard: {
    series: ["THE", "JEWEL"],                // the last line is set giant
    label: "MANIFESTO:",
    episode: "The Continuity of a Person.",  // wraps under the giant line if long
  },
},
```

- **To swap the opening image**, put your own square-ish image in
  `assets/manifesto/` and point `image` at it (an address starting with `/`
  is relative to the site's folder, as everywhere in `content.js`; match the
  file name's letter case). Dark images with a bright centre work best: the
  edges melt into black.
- **The title card** takes one or more `series` lines (the last is the giant
  one), then `label` in a condensed sans and the indented `episode` line.
- `manifesto: false` (or no `manifesto` at all) removes the link and the page.

The collage in `assets/manifesto.js` (the `LAND`, `MID` and `PORT`
arrangements, for wide, squarish and tall screens) is made of phrases from
the text. Its block sizes come from the words themselves, and blocks marked
`opt(...)` come and go to suit the screen's shape, so edit phrases freely
and every block still fills its space.

**About the opening image.** `assets/manifesto/opening.jpg` is a still from
the film *Ghost in the Shell* (1995); its rights belong to their owners. It
is used here as a reference. Replace it with your own image if you prefer,
or if you publish this site somewhere its use isn't appropriate.

## Preview locally

You need [Node.js](https://nodejs.org) 18 or newer.

```sh
node dev.mjs
# open http://localhost:4321/geraldo/
```

The server reads the `<base href>` from `index.html` and serves the site
under that folder, just as it will be hosted (`/` redirects there). With
`<base href="/">` it serves the site at `http://localhost:4321/`. Use
`PORT=8080 node dev.mjs` for another port, and restart the server after
changing the folder. Like GitHub Pages, it treats file names as
case-sensitive.

You can also double-click `index.html`. Opened from disk, pages use
addresses like `index.html#/work/company-one`.

## Deploy

Upload the whole folder to any static host. There is no build step; the
output directory is the folder itself.

The site can live at the root of a domain (`https://you.com/`) or in a
sub-folder (`https://you.github.io/portfolio/`). One setting decides which:
the `<base href>` at the top of `<head>` in `index.html`. It must start and
end with `/`:

```html
<base href="/portfolio/">  <!-- a sub-folder -->
<base href="/">            <!-- the root of a domain -->
```

Every asset address in `index.html` is relative (`assets/site.css`,
`content.js`, ...), and the `<base>` makes them resolve from the site's
folder even on a deep link like `/portfolio/work/company-one`, with or
without JavaScript. Page addresses are the folder plus the page path. (If
the page is ever served from outside that folder, for example at the root
of a custom domain before you change the setting, the script next to it
falls back to `/` so the site still loads.)

### Deploying to GitHub Pages under a sub-folder

A repository named `geraldo` under the account `Jikjii` is published at
`https://jikjii.github.io/geraldo/`.

1. In `index.html`, set `<base href="/geraldo/">` (the repository name
   between slashes).
2. In `content.js`, set `url: "https://jikjii.github.io/geraldo"`.
3. In `index.html`, point the canonical link and `og:url` at
   `https://jikjii.github.io/geraldo/`, and `og:image` and `twitter:image`
   at `https://jikjii.github.io/geraldo/assets/og.png`.
4. Copy the page over the 404 page, so deep links boot the site:

   ```sh
   cp index.html 404.html
   ```

5. Push everything (including the empty `.nojekyll`; `.gitignore` keeps
   local tool settings out) to the `main` branch, then go to Settings →
   Pages → Build and deployment → Deploy from a branch, and pick `main` and
   `/ (root)`.

GitHub Pages answers an address like `/geraldo/projects/crewroom`, which
has no file of its own, with `404.html`; the script reads the address and
opens that page. That answer carries a 404 status: browsers show the page
normally, but search engines skip such addresses, so expect only the home
page to be indexed. Link previews (Slack, LinkedIn, iMessage, X) also read
that 404 response and the home page's tags, so a shared deep link previews
as the home page, or not at all. Share the home address when the preview
matters.

A `username.github.io` repository is served at the root of its domain
instead: use `<base href="/">` there.

### Other hosts (root of a domain)

For these, set `<base href="/">`, set `url` and the addresses in
`index.html` to your domain, and copy `index.html` to `404.html` (except on
Cloudflare Pages, below). `vercel.json` and `_redirects` are written for a
site at the root of its domain; they have no effect on GitHub Pages.

- **Vercel**: import the repository, set Framework Preset to "Other", and
  leave the build command empty. `vercel.json` routes page addresses to
  `index.html`.
- **Netlify**: drag the folder onto app.netlify.com/drop, or connect the
  repository with publish directory `.`. `_redirects` handles page addresses
  (and keeps a mistyped `/assets/...` file a real 404).
- **Cloudflare Pages**: connect the repository with no build command and
  output directory `/`. **Delete `404.html` for this host**: without it,
  Cloudflare serves `index.html` for every page address automatically.

### Custom domain

Add the domain in your host's dashboard and follow its DNS instructions.
Where the site ends up depends on which repository gets the domain on
GitHub Pages:

- **Added to this repository** (`geraldo`): the site moves to the root
  of the domain (`https://your-domain/`). Set `<base href="/">` in
  `index.html`, set `url` in `content.js` to the new address, replace
  `https://jikjii.github.io/geraldo` in `index.html` (canonical link,
  `og:url`, `og:image`, `twitter:image`), and copy it to `404.html` again.
- **Added to your `username.github.io` repository**: this site stays in its
  folder (`https://your-domain/geraldo/`). Keep `<base href="/geraldo/">`
  and change only `url`, the canonical link, `og:url`, `og:image` and
  `twitter:image`, then copy `index.html` to `404.html` again.

On other hosts, a custom domain serves the site at its root: use
`<base href="/">` and update the same addresses.

## Palettes

Each palette is a loop of bright colours. The wall drifts through them in
order, and most of what you see sits at 60–80% brightness, so choose vivid
colours and avoid near-black ones: the wall supplies its own darkness.

```js
palettes: {
  // ...keep the ones your pages use...
  sunset: { seed: 5, stops: ["#ff5f6d", "#ff9966", "#ffc371", "#ffe29a", "#ff8c69"] },
},
```

Use it with `palette: "sunset"` on any page, or pass the colours directly:
`palette: ["#ff5f6d", "#ffc371", "#ffe29a"]`. `seed` is optional; each value
gives the brightness pattern its own texture. `defaultPalette` sets the home
page's palette and the palette of any page without one.

`content.js` comes with `amber` (the default), `olive`, `daylight`, `meadow`,
`sky`, `ember`, `crimson`, `dusk`, `rose`, `mint` and `glacier`. They live in
that file, so if you delete one, pages that name it fall back to the default.
Only `amber` is also built into `site.js`, as the fallback.

Hovering a sidebar link previews its page's palette. The preview is off while
a page with its own palette is open.

## Link-preview image

```sh
node tools/make-og.mjs          # uses defaultPalette
node tools/make-og.mjs olive    # or any palette name
```

This rewrites `assets/og.png`. Make sure `og:image` in `index.html` points to
your site's full address (for example
`https://jikjii.github.io/geraldo/assets/og.png`).

## Typeface

The site uses [Schibsted Grotesk](https://fonts.google.com/specimen/Schibsted+Grotesk)
at weights 400 and 500 (plus italic) from Google Fonts. It loads with
`display=block`, so text appears once the font is ready instead of flashing
in a fallback first. To change it:

1. Replace the Google Fonts `<link>` in `index.html` (and `404.html`).
2. Change `--font` at the top of `assets/site.css`.
3. Optionally retune the `"Schibsted Grotesk Fallback"` metrics in
   `site.css`. They only matter if the web font fails to load.

## Sound

The speaker at the bottom right of the sidebar turns music on and off, and so
does the **M** key. Sound is off until a visitor turns it on. Their choice is
remembered in their browser, and on later visits it starts again on their
first click or key press (browsers don't allow sound before that).

- With `sound: { src: null }` the site plays a quiet generated ambient pad:
  slow, soft chords made in the browser, with no file to download.
- To use your own music, add a loopable file (for example
  `assets/soundtrack.mp3`) and set `src: "/assets/soundtrack.mp3"` (relative
  to the site's folder, like every address in `content.js` that starts with
  `/`, and with the file name's exact letter case). It fades in and out over
  about a second.
- `volume` is 0 to 1. `autoStart: true` also starts sound on a first-time
  visitor's first click or key press.
- `shortcut: false` turns off the **M** key (single-key shortcuts can be
  triggered by accident with speech input).
- `sound: false` removes the toggle.

## Keyboard and accessibility

- **Tab** moves through the links. Focus shows as a subtle outline in the
  link colour, for keyboard users only.
- **Enter** opens a page. Clicking the open page's link (the one with the
  dot) closes it; screen readers announce that link as "Close …".
- **Esc** closes the deepest open page. If focus was inside it, focus returns
  to the link that opened it.
- **M** toggles sound (unless `sound.shortcut` is `false`).
- In the Manifesto, **Space** or **Enter** skips the opening, **Esc** closes
  it, and focus returns to the Manifesto link. It is a dialog: Tab stays
  inside it.
- With "reduce motion" turned on in the operating system, the intro bloom is
  skipped, pages open and close instantly, and the wall stops drifting: it
  only reacts to your pointer. The Manifesto opens straight on its collage.
- Visitors without JavaScript see your name, bio and links as plain text
  (the fallback in `index.html`); the pages themselves need JavaScript.

## How it works

- The wall is one canvas of 19px tiles on a 20px grid. The sidebar sits above
  it and opened pages sit **below** it.
- A page "opens" when the canvas clears the tiles over it, cell by cell,
  behind a jagged front that moves at a constant 266px/s and carries a band
  of light. Closing paints the tiles back from right to left, then removes the
  page.
- Colour comes from two slow value-noise fields: one picks the palette
  position, one sets the brightness. Palettes crossfade over 1.3 seconds when
  you navigate.
- Pages at the same depth swap in place under a wavy band of light that sweeps
  down the pane.
- On narrow screens the stage scrolls sideways and a "camera" glides to each
  new pane at the same pace as the wipe.

## Credits

Design inspired by [shreygups.com](https://shreygups.com) by Shrey Gupta.
Typeface: Schibsted Grotesk (SIL Open Font License).
Manifesto typefaces: Shippori Mincho B1, Archivo and IBM Plex Mono (SIL Open
Font License). Its opening sequence and title card pay homage to *Ghost in
the Shell* (1995) and *Neon Genesis Evangelion*; the opening image is a still
from the former, and its rights belong to their owners.
