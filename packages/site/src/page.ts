import type { CodeLine, Content, Figure } from './content.js';
import {
  NPM_ORG_URL,
  REPOSITORY_URL,
  SITE_URL,
  npmUrl,
  packageFacts,
  packageIds,
  readmeUrl,
  specUrl,
} from './data.js';
import { markup, raw, type Interpolation } from './html.js';

export interface PageOptions {
  /** Path from this page to the site root: '' for the English page, '../' for Korean. */
  readonly root: string;
  /** Path from this page to the other language's page. */
  readonly switchHref: string;
}

const line = (entry: CodeLine): Interpolation => {
  switch (entry.kind) {
    case 'command':
      return markup`<span class="code__prompt" aria-hidden="true">$ </span>${entry.text}`;
    case 'comment':
      return markup`<span class="code__comment">${entry.text}</span>`;
    case 'output':
      return entry.text;
  }
};

function figure(content: Figure): Interpolation {
  const lines = content.lines.map((entry) => markup`${line(entry)}${raw('\n')}`);
  return markup`<figure class="code">
    <figcaption class="code__caption">${content.caption}</figcaption>
    <pre class="code__body" tabindex="0"><code>${lines}</code></pre>
  </figure>`;
}

const hiddenContext = (text: string): Interpolation =>
  markup`<span class="visually-hidden"> (${text})</span>`;

function header(content: Content, options: PageOptions): Interpolation {
  const { nav } = content;
  return markup`<header class="site-header">
    <div class="container site-header__inner">
      <a class="brand" href="./">
        <picture>
          <source media="(prefers-color-scheme: dark)" srcset="${options.root}logo-dark.svg" />
          <img class="brand__logo" src="${options.root}logo.svg" alt="" width="32" height="32" />
        </picture>
        <span class="brand__name">sdlc-tools</span>
      </a>
      <nav class="site-nav" aria-label="${nav.label}">
        <ul class="site-nav__list">
          <li><a class="site-nav__link" href="#contract">${nav.contract}</a></li>
          <li><a class="site-nav__link" href="#packages">${nav.packages}</a></li>
          <li><a class="site-nav__link" href="#examples">${nav.examples}</a></li>
          <li><a class="site-nav__link" href="${REPOSITORY_URL}">${nav.source}</a></li>
        </ul>
      </nav>
      <nav class="site-nav" aria-label="${nav.languageLabel}">
        <a
          class="site-nav__link"
          href="${options.switchHref}"
          lang="${content.otherLanguage.lang}"
          hreflang="${content.otherLanguage.lang}"
          >${content.otherLanguage.name}</a
        >
      </nav>
    </div>
  </header>`;
}

function hero(content: Content): Interpolation {
  const { hero: copy } = content;
  return markup`<section class="hero" aria-labelledby="hero-title">
    <div class="container hero__inner">
      <div class="hero__copy">
        <h1 id="hero-title" class="hero__title">${copy.heading}</h1>
        <p class="hero__lead">${copy.lead}</p>
        <p class="actions">
          <a class="button button--primary" href="#packages">${copy.start}</a>
          <a class="button button--secondary" href="${REPOSITORY_URL}">${copy.source}</a>
        </p>
      </div>
      <div class="hero__code">${figure(copy.install)}</div>
    </div>
  </section>`;
}

function contract(content: Content): Interpolation {
  const { contract: copy } = content;
  return markup`<section class="section" id="contract" aria-labelledby="contract-title">
    <div class="container">
      <h2 id="contract-title" class="section__title">${copy.heading}</h2>
      <p class="section__intro">${copy.intro}</p>
      <ul class="grid features">
        ${copy.features.map(
          (feature) =>
            markup`<li class="feature">
              <h3 class="feature__title">${feature.title}</h3>
              <p class="feature__text">${feature.text}</p>
            </li>`,
        )}
      </ul>
      <p class="section__more">
        <a class="link" href="${specUrl(content.lang)}">${copy.spec}</a>
      </p>
    </div>
  </section>`;
}

function packages(content: Content): Interpolation {
  const { packages: copy } = content;
  return markup`<section
    class="section section--surface"
    id="packages"
    aria-labelledby="packages-title"
  >
    <div class="container">
      <h2 id="packages-title" class="section__title">${copy.heading}</h2>
      <p class="section__intro">${copy.intro}</p>
      <ul class="grid cards">
        ${packageIds.map((id) => {
          const facts = packageFacts[id];
          const label = hiddenContext(facts.name);
          return markup`<li class="card">
            <p class="card__kind">
              ${facts.command === null ? copy.kind.library : copy.kind.tool}
              ${facts.command !== null && markup`<code class="card__command">${facts.command}</code>`}
            </p>
            <h3 class="card__title"><code>${facts.name}</code></h3>
            <p class="card__text">${copy.summaries[id]}</p>
            <div class="card__code">
              <pre
                class="code__body"
                tabindex="0"
              ><code><span class="code__prompt" aria-hidden="true">$ </span>${facts.install}
</code></pre>
            </div>
            <p class="card__links">
              <a class="link" href="${readmeUrl(content.lang, id)}">${copy.readme}${label}</a>
              <a class="link" href="${npmUrl(id)}">${copy.npm}${label}</a>
            </p>
          </li>`;
        })}
      </ul>
    </div>
  </section>`;
}

function examples(content: Content): Interpolation {
  const { examples: copy } = content;
  return markup`<section class="section" id="examples" aria-labelledby="examples-title">
    <div class="container">
      <h2 id="examples-title" class="section__title">${copy.heading}</h2>
      <p class="section__intro">${copy.intro}</p>
      <div class="grid examples">
        <div class="example">
          ${figure(copy.people)}
          <p class="example__text">${copy.people.text}</p>
        </div>
        <div class="example">
          ${figure(copy.agents)}
          <p class="example__text">${copy.agents.text}</p>
        </div>
      </div>
    </div>
  </section>`;
}

function footer(content: Content): Interpolation {
  const { footer: copy } = content;
  return markup`<footer class="site-footer">
    <div class="container site-footer__inner">
      <p class="site-footer__note">${copy.privacy}</p>
      <ul class="site-footer__links">
        <li><a class="link" href="${REPOSITORY_URL}">GitHub</a></li>
        <li><a class="link" href="${NPM_ORG_URL}">${copy.npmOrg}</a></li>
        <li><a class="link" href="${REPOSITORY_URL}/issues">${copy.issues}</a></li>
        <li><a class="link" href="${REPOSITORY_URL}/blob/main/LICENSE">${copy.license}</a></li>
      </ul>
    </div>
  </footer>`;
}

export function renderPage(content: Content, options: PageOptions): string {
  const alternates = [
    markup`<link rel="alternate" hreflang="en" href="${SITE_URL}" />`,
    markup`<link rel="alternate" hreflang="ko" href="${SITE_URL}ko/" />`,
    markup`<link rel="alternate" hreflang="x-default" href="${SITE_URL}" />`,
  ];
  const page = markup`<!doctype html>
    <html lang="${content.lang}">
      <head>
        <meta charset="utf-8" />
        <meta name="viewport" content="width=device-width, initial-scale=1" />
        <meta name="color-scheme" content="light dark" />
        <title>${content.title}</title>
        <meta name="description" content="${content.description}" />
        <link rel="icon" href="${options.root}logo.svg" type="image/svg+xml" />
        <link
          rel="icon"
          href="${options.root}logo-dark.svg"
          type="image/svg+xml"
          media="(prefers-color-scheme: dark)"
        />
        ${alternates}
        <link rel="stylesheet" href="${options.root}styles.css" />
      </head>
      <body>
        <a class="skip-link" href="#main">${content.skipLink}</a>
        ${header(content, options)}
        <main id="main">
          ${hero(content)}${contract(content)}${packages(content)}${examples(content)}
        </main>
        ${footer(content)}
      </body>
    </html> `;
  return page.toString();
}
