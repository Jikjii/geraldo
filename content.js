/*
 * content.js - the only file you need to edit.
 *
 * Everything on the site comes from this one object: your name, the sidebar,
 * every page, the colours of the light wall and the music.
 *
 * Page addresses are made from the slugs:
 *   work item     ->  /work/<slug>
 *   projects page ->  /projects
 *   project item  ->  /projects/<slug>
 * They sit inside the site's folder (<base href> at the top of index.html), so
 * on https://jikjii.github.io/geraldo/ the first work item lives at
 * https://jikjii.github.io/geraldo/work/<slug>.
 *
 * Page bodies are Markdown written inside backticks (`...`), so they can span
 * several lines. Supported: paragraphs, [links](https://example.com),
 * *italics*, **bold**, `code`, # headings, - bullet lists, 1. numbered lists,
 * > blockquotes, --- rules and ![images](/assets/photo.jpg).
 * Links to other pages on this site (for example [my projects](/projects))
 * open as panes instead of reloading the page.
 *
 * Addresses that start with "/" (in bodies, the bio, link urls and
 * sound.src) are relative to the site's folder, not the domain: write
 * /projects and /assets/photo.jpg rather than /geraldo/projects. That way
 * this file works unchanged at the root of a domain, in a sub-folder and
 * opened from disk. Full addresses (https://...) are used exactly as written.
 * Match the file name's letter case exactly: GitHub Pages treats
 * /assets/Photo.JPG and /assets/photo.jpg as different files.
 *
 * Inside a body, a bare backtick ends the text early and ${ starts a JavaScript
 * placeholder; either one breaks the whole site. Put a backslash in front:
 * write \` for a backtick (so inline code looks like \`code\`) and \${ for ${.
 * If the page ever shows "content.js failed to load", look for one of these.
 *
 * After editing, reload the page. If you changed the default palette, you can
 * also run `node tools/make-og.mjs` to redraw the social preview image.
 */
window.SITE = {
  // Shown at the top of the sidebar and in every tab title ("Page | Your Name").
  name: "Geraldo Grell",

  // The line under your name in the sidebar. Markdown works here too.
  bio: "Hi! I love to build, and I have an addiction to making Vocaloids.",

  // For search engines and link previews. Leave it out to reuse the bio.
  description: "Geraldo Grell loves to build, makes Vocaloids, and is building Crewroom.",

  // The "Email" button in the sidebar copies this address. Remove it to hide the button.
  email: "swegeraldogrell@gmail.com",

  // Your site's public address, including its folder if it has one, without a
  // trailing slash. Used for canonical links and search engines.
  url: "https://jikjii.github.io/geraldo",

  // Music toggle (the small speaker at the bottom right of the sidebar).
  //   src:       null plays a soft generated ambient pad; or point it at your own
  //              looping file, for example "/assets/soundtrack.mp3" (relative to the
  //              site's folder, like every address here that starts with "/").
  //   volume:    0 to 1.
  //   autoStart: false = sound stays off until a visitor turns it on (their choice is
  //              remembered). true = also start on a first-time visitor's first click or key.
  //   shortcut:  true = the M key also toggles sound. Set it to false if you want no
  //              single-key shortcuts (some speech-input users trigger them by accident).
  // Set `sound: false` to remove the toggle entirely.
  sound: {
    src: null,
    volume: 0.8,
    autoStart: false,
    shortcut: true,
  },

  // The palette the light wall uses on the home page and on any page without its own.
  defaultPalette: "amber",

  // Work: the first list in the sidebar. Each item opens a pane at /work/<slug>.
  //   palette: a name from the palettes list at the bottom of this file,
  //            or your own list of colours, e.g. ["#ff7a59", "#ffd6a5", "#ffe566"].
  //   description (optional): the text search engines show; defaults to the first sentence.
  // workTitle (optional) names this list for screen readers; it defaults to "Work".
  // workTitle: "Work",
  work: [
    // {
    //   title: "Company",
    //   slug: "company",
    //   palette: "olive",
    //   body: `
    //     A few short paragraphs about what you built, owned and learned there.
    //   `,
    // },
  ],

  // Projects: one "Projects" link in the sidebar opens a list, and each project
  // opens its own pane further right at /projects/<slug>.
  // Give a project `url: "https://..."` and no body to link straight out instead.
  projectsTitle: "Projects",
  // Optional: a Markdown line above the list, the Projects page's own palette,
  // and the text search engines show for /projects.
  // projectsIntro: "Things I've built on evenings and weekends.",
  // projectsPalette: "mint",
  // projectsDescription: "Side projects by Your Name.",
  projects: [
    {
      title: "Crewroom",
      slug: "crewroom",
      palette: "dusk",
      description: "Crewroom is an app for cosplayers and the crews behind them: plan the shoot, share the work, credit the people who help.",
      body: `
        I'm building [Crewroom](https://joincrewroom.com/beta), an app for cosplayers and the crews behind them: the friends, photographers and makers who help a look come to life.

        **Crew coordination.** Turn a group cosplay or shoot from "we should" into a day that actually happens. The lineup, prep tasks and meeting details live together in a private crew.

        **Creative network.** Share progress and finished work with making notes and collaborator credits, build a shared history with the people you create with, and find new collaborators and opportunities.

        We're starting with cosplayers in New York City, with an iPhone beta on TestFlight. [Request access](https://joincrewroom.com/beta).
      `,
    },
  ],

  // Optional extra groups that work like Projects (a sidebar link that opens a list).
  // Each item opens at /<group slug>/<item slug>. `intro`, `palette` and
  // `description` are optional, just like on Projects.
  groups: [
    // {
    //   title: "Writing",
    //   slug: "writing",
    //   intro: "Occasional notes.",
    //   palette: "rose",
    //   description: "Notes and essays by Geraldo Grell.",
    //   items: [
    //     { title: "A first post", slug: "a-first-post", body: `Hello!` },
    //   ],
    // },
  ],

  // Links at the bottom of the sidebar. The Email button is added after them.
  social: [
    { label: "GitHub", url: "https://github.com/Jikjii" },
    { label: "X", url: "https://x.com/GERALDONOMICS" },
    { label: "LinkedIn", url: "https://www.linkedin.com/in/geraldo-grell/" },
  ],

  // Light-wall palettes. Each is a loop of bright colours; the wall drifts through
  // them in order. Avoid near-black colours, the wall supplies its own darkness.
  // `seed` is optional: it gives each palette its own brightness pattern.
  // Add your own here and use its name in `palette:` above.
  palettes: {
    amber:    { seed: 0,  stops: ["#ff2d00", "#ff5400", "#ff6b1a", "#ff8510", "#ff9f1c", "#ffb703", "#ffc933", "#ffd60a", "#ffe566", "#ff8a3d", "#ff4d1a"] },
    olive:    { seed: 11, stops: ["#6b8f3a", "#8faf4a", "#c4b44a", "#e6d36a", "#f0e6a8", "#9aaa4a"] },
    daylight: { seed: 23, stops: ["#fff6d0", "#ffe566", "#ffd60a", "#c8f0ff", "#9ad8ff", "#ffe8a0"] },
    meadow:   { seed: 31, stops: ["#3d9a4a", "#7bbf4a", "#d4e05a", "#ffe566", "#8fd17a", "#c6e86a"] },
    sky:      { seed: 89, stops: ["#4a8fd4", "#7eb6e8", "#c9d8f0", "#ffe566", "#2d6cb5", "#f0e6a8"] },
    ember:    { seed: 67, stops: ["#ff2d00", "#ff5400", "#ff9f1c", "#ffd60a", "#ff8a3d", "#ff6b1a"] },
    crimson:  { seed: 79, stops: ["#c8102e", "#e23a3a", "#ff6b1a", "#ff9f1c", "#ffd0a0", "#8b1e2d"] },
    dusk:     { seed: 43, stops: ["#7b5cff", "#b45cff", "#ff5cc8", "#ff8a8a", "#ffc49a", "#d98cff"] },
    rose:     { seed: 53, stops: ["#ff3d6e", "#ff6b8b", "#ff9eb5", "#ffc2d1", "#ffe0e8", "#ff7a9c"] },
    mint:     { seed: 37, stops: ["#2ec4a0", "#4fe0b0", "#9ff0c8", "#dcfce8", "#f4f7a8", "#6fe3c1"] },
    glacier:  { seed: 97, stops: ["#5ac8fa", "#8fdcff", "#c9f0ff", "#f0fbff", "#7fb2ff", "#a8e6f0"] },
  },
};
