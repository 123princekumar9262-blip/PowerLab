import { Suspense, useEffect } from "react";
import {
  fullName,
  labById,
  targetOf,
  topicOf,
  type ModeId,
} from "../catalogue/catalogue.ts";
import { workspaceFor } from "../workspaces/index.ts";
import type { WorkspaceActivity } from "../workspaces/types.ts";
import { NotFoundPage } from "./pages.tsx";
import { getLevel, setLevel } from "./prefs.ts";
import { recordActivity } from "./progress.ts";
import { href, replace, replaceQuietly } from "./router.ts";
import { Crumbs, StatusTag } from "./ui.tsx";

/**
 * A lab workspace behind its route. The route selects the lab, the topic and the mode; the workspace
 * owns everything else and reports what it shows, so the address, "Continue" and "Recent" stay true.
 */
export function WorkspacePage({
  labId,
  topicId,
  mode,
  query,
}: {
  labId: string;
  topicId: string;
  mode: ModeId;
  query: Record<string, string>;
}) {
  const lab = labById(labId);
  const topic = lab ? topicOf(lab, topicId) : undefined;
  // entry points and modes this lab does not have resolve to a canonical address
  const redirect =
    !lab || !topic
      ? null
      : topic.opens
        ? hrefOf(targetOf(lab, topic))
        : !lab.modes.includes(mode)
          ? href.workspace(lab.id, topic.id)
          : null;
  useEffect(() => {
    if (redirect) replace(redirect);
  }, [redirect]);
  if (!lab) return <NotFoundPage path={`/labs/${labId}/${topicId}`} />;
  if (!topic)
    return (
      <div className="page page--narrow">
        <Crumbs
          items={[
            { label: "Labs", href: href.labs() },
            { label: lab.title, href: href.lab(lab.id) },
            { label: topicId },
          ]}
        />
        <h1 tabIndex={-1}>Not in this lab</h1>
        <p>
          {lab.title} has no topic “{topicId}”.{" "}
          <a href={href.lab(lab.id)}>See what {lab.title} offers</a>.
        </p>
      </div>
    );
  if (redirect) return null;
  if (topic.status !== "ready")
    return (
      <div className="page page--narrow">
        <Crumbs
          items={[
            { label: "Labs", href: href.labs() },
            { label: lab.title, href: href.lab(lab.id) },
            { label: topic.title },
          ]}
        />
        <h1 tabIndex={-1}>
          {topic.title} <StatusTag status={topic.status} />
        </h1>
        <p>{topic.purpose}. This topic is planned but not built yet.</p>
        <p>
          <a className="btn" href={href.lab(lab.id)}>
            ← {lab.title}
          </a>
        </p>
      </div>
    );
  // every workspace is the universal workspace shell: it brings its own header (back link, title, modes)
  const Workspace = workspaceFor(lab.id);
  if (!Workspace) return <NotFoundPage path={`/labs/${labId}/${topicId}`} />;

  const onActivity = (a: WorkspaceActivity) => {
    const t = topicOf(lab, a.topic);
    if (!t) return;
    replaceQuietly(href.workspace(lab.id, a.topic, a.mode, a.query));
    document.title = `${fullName(t)} — ${lab.title} · Power Electronics Lab`;
    recordActivity({
      lab: lab.id,
      topic: a.topic,
      mode: a.mode,
      query: a.query,
      title: fullName(t),
      labTitle: lab.title,
      lesson: a.lesson,
    });
    if (a.level !== getLevel()) setLevel(a.level);
  };

  return (
    <div className="workspace-page">
      <Suspense
        fallback={
          <div className="ws-loading" role="status">
            Loading the {lab.title} lab…
          </div>
        }
      >
        <Workspace
          topic={topicId}
          mode={mode}
          query={query}
          level={getLevel()}
          onActivity={onActivity}
        />
      </Suspense>
    </div>
  );
}

function hrefOf(t: {
  lab: string;
  topic: string;
  mode?: ModeId;
  query?: Record<string, string>;
}) {
  return href.workspace(t.lab, t.topic, t.mode, t.query);
}
