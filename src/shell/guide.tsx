import { CATEGORY_LABEL, CATEGORY_ORDER, fullName, labById, LABS, topicOf, type Lab } from '../catalogue/catalogue.ts'
import { LAB_LEVEL, LEVEL_LABEL } from '../catalogue/levels.ts'
import { GUIDE } from '../guide/content.ts'
import type { GuideArticle, GuideBlock } from '../guide/types.ts'
import { Icon } from './icons.tsx'
import { NotFoundPage } from './pages.tsx'
import { href } from './router.ts'
import { Crumbs, PageHead } from './ui.tsx'

/**
 * THE LAB GUIDE — theory pages laid out like documentation: the lab's pages on the left, the article in the
 * middle, and beside it the circuits it is about and the questions WHY answers there. Every "Try it" opens the
 * circuit with the article's values; every worked example is confirmed by the simulation (tests/guide.test.ts).
 */
export function GuidePage({ lab, section }: { lab: string | null; section: string | null }) {
  if (!lab) return <GuideHome />
  const l = labById(lab)
  if (!l) return <NotFoundPage path={`/guide/${lab}`} />
  const pages = GUIDE.filter((a) => a.lab === lab)
  if (!pages.length)
    return (
      <div className="page page--narrow">
        <Crumbs items={[{ label: 'Lab guide', href: href.guide() }, { label: l.title }]} />
        <PageHead title={`${l.title} guide`} lead="The theory pages for this lab are being written." />
        <p>
          <a className="btn" href={href.lab(l.id)}>
            Open the {l.title} lab
          </a>
        </p>
      </div>
    )
  const article = section ? pages.find((a) => a.id === section) : pages[0]
  if (!article) return <NotFoundPage path={`/guide/${lab}/${section}`} />
  const k = pages.indexOf(article)
  return (
    <div className="guide">
      <GuideNav lab={l} pages={pages} current={article.id} />
      <article className="guide-article" aria-labelledby="guide-title">
        <Crumbs items={[{ label: 'Lab guide', href: href.guide() }, { label: l.title, href: href.guide(l.id) }, { label: article.title }]} />
        <p className="eyebrow guide-group">{article.group}</p>
        <h1 id="guide-title" tabIndex={-1}>
          {article.title}
        </h1>
        <p className="guide-summary">{article.summary}</p>
        {article.blocks.map((b, i) => {
          const prev = article.blocks[i - 1]
          return <Block key={i} b={b} headed={prev?.kind === 'h' && /example/i.test(prev.text)} />
        })}
        <nav className="guide-pager" aria-label="Pages">
          {k > 0 ? (
            <a href={href.guide(l.id, pages[k - 1].id)}>
              <span className="muted small">Previous</span>
              <span>{pages[k - 1].title}</span>
            </a>
          ) : (
            <span />
          )}
          {k < pages.length - 1 && (
            <a className="guide-pager-next" href={href.guide(l.id, pages[k + 1].id)}>
              <span className="muted small">Next</span>
              <span>{pages[k + 1].title}</span>
            </a>
          )}
        </nav>
      </article>
      <GuideAside lab={l} article={article} />
    </div>
  )
}

/** The guide's front page: every lab with its pages, grouped like the sidebar. */
function GuideHome() {
  return (
    <div className="page">
      <PageHead title="Lab guide" lead="Short theory pages for every lab: the idea, the equation, what it means, a worked example, and a “Try it” that opens the circuit. Every example is checked against the simulation." />
      {CATEGORY_ORDER.map((c) => (
        <section key={c} className="lab-group" aria-labelledby={`gd-${c}`}>
          <h2 id={`gd-${c}`} className="group-title">
            {CATEGORY_LABEL[c]}
          </h2>
          <div className="tile-grid">
            {LABS.filter((l) => l.category === c).map((l) => {
              const pages = GUIDE.filter((a) => a.lab === l.id)
              const level = LAB_LEVEL[l.id]
              return (
                <a key={l.id} className="lab-tile" href={href.guide(l.id)}>
                  <span className="lab-tile-head">
                    <span className="lab-tile-title">{l.title}</span>
                    {level && <span className={`lvl lvl--${level}`}>{LEVEL_LABEL[level]}</span>}
                  </span>
                  <span className="lab-tile-line">{pages.length ? pages.slice(0, 3).map((p) => p.title).join(' · ') : 'Pages being written'}</span>
                  <span className="lab-tile-meta">
                    <span>
                      {pages.length} page{pages.length === 1 ? '' : 's'}
                    </span>
                    <span className="lab-tile-open">
                      Read <Icon name="arrow" />
                    </span>
                  </span>
                </a>
              )
            })}
          </div>
        </section>
      ))}
    </div>
  )
}

/** The lab's pages, by group, in reading order. */
function GuideNav({ lab, pages, current }: { lab: Lab; pages: GuideArticle[]; current: string }) {
  const groups: Array<[string, GuideArticle[]]> = []
  for (const p of pages) {
    const g = groups.find(([name]) => name === p.group)
    if (g) g[1].push(p)
    else groups.push([p.group, [p]])
  }
  return (
    <nav className="guide-nav" aria-label={`${lab.title} guide`}>
      <a className="guide-nav-lab" href={href.guide()}>
        ← All guides
      </a>
      <p className="guide-nav-title">{lab.title}</p>
      {groups.map(([g, ps]) => (
        <div key={g} className="guide-nav-group">
          <p className="side-heading">{g}</p>
          {ps.map((p) => (
            <a key={p.id} href={href.guide(lab.id, p.id)} className={p.id === current ? 'on' : ''} aria-current={p.id === current ? 'page' : undefined}>
              {p.title}
            </a>
          ))}
        </div>
      ))}
    </nav>
  )
}

/** Beside the article: the circuits it is about, and what WHY answers there. */
function GuideAside({ lab, article }: { lab: Lab; article: GuideArticle }) {
  const topics = article.topics.map((id) => topicOf(lab, id)).filter((t) => !!t && t.status === 'ready')
  const first = topics[0]
  return (
    <aside className="guide-aside" aria-label="In the lab">
      <p className="eyebrow">In the lab</p>
      {topics.map((t) => (
        <a key={t!.id} className="guide-card" href={href.workspace(lab.id, t!.id)}>
          <b>{fullName(t!)}</b>
          <span className="muted small">{t!.purpose}</span>
          <span className="lab-tile-open">
            Open circuit <Icon name="arrow" />
          </span>
        </a>
      ))}
      {!topics.length && (
        <a className="guide-card" href={href.lab(lab.id)}>
          <b>{lab.title}</b>
          <span className="lab-tile-open">
            Open the lab <Icon name="arrow" />
          </span>
        </a>
      )}
      {article.whyPrompts && article.whyPrompts.length > 0 && (
        <>
          <p className="eyebrow guide-aside-why">Ask WHY in the lab</p>
          <ul className="guide-why">
            {article.whyPrompts.map((q) => (
              <li key={q}>{q}</li>
            ))}
          </ul>
          {first && (
            <a className="small guide-why-go" href={href.workspace(lab.id, first.id)}>
              Open the circuit, then press WHY →
            </a>
          )}
        </>
      )}
    </aside>
  )
}

function Block({ b, headed }: { b: GuideBlock; headed?: boolean }) {
  switch (b.kind) {
    case 'p':
      return <p>{b.text}</p>
    case 'h':
      return <h2 className="guide-h">{b.text}</h2>
    case 'list':
      return (
        <ul className="guide-list">
          {b.items.map((x) => (
            <li key={x}>{x}</li>
          ))}
        </ul>
      )
    case 'eq':
      return (
        <div className="guide-eq">
          <span className="guide-eq-expr">{b.eq.expr}</span>
          {b.eq.note && <span className="guide-eq-note">{b.eq.note}</span>}
        </div>
      )
    case 'example':
      return (
        <div className="guide-example">
          {!headed && <p className="eyebrow">Worked example</p>}
          <p>{b.text}</p>
          <p className="guide-example-result">
            <b>{b.result}</b> <span className="muted small">· confirmed by the simulation</span>
          </p>
        </div>
      )
    case 'try':
      return (
        <div className="guide-try">
          <span>
            <b>Try it</b> <span className="muted">{b.text}</span>
          </span>
          <a className="btn btn--primary" href={href.workspace(b.lab, b.topic, b.mode ?? 'explore', b.query)}>
            Open in the lab
          </a>
        </div>
      )
  }
}
