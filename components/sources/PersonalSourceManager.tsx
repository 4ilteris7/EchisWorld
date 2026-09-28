"use client";

import { useMemo, useState } from "react";
import styles from "./PersonalSourceManager.module.css";

type Draft = {
  name: string;
  connectorType: "rss" | "json";
  endpoint: string;
  category: "global" | "cyber" | "defense" | "policy";
  language: string;
  regionScope: string;
};

type Probe = {
  itemCount: number;
  finalUrl: string;
  samples: Array<{ title: string; url?: string; publishedAt?: string }>;
};

const INITIAL: Draft = {
  name: "",
  connectorType: "rss",
  endpoint: "",
  category: "global",
  language: "en",
  regionScope: "global",
};

function errorMessage(code: string): string {
  const messages: Record<string, string> = {
    invalid_name: "Enter a source name between 2 and 120 characters.",
    invalid_url: "Enter a valid source URL.",
    https_required: "Personal sources must use HTTPS.",
    credentials_in_url_not_allowed: "Credentials cannot be embedded in the URL.",
    invalid_rss: "The response is not a readable RSS or Atom feed.",
    invalid_json_feed: "The response is not a supported public JSON feed.",
    no_parseable_items: "The connection worked, but no usable items were found.",
    source_already_exists: "This source is already registered on this installation.",
    personal_sources_local_only: "Personal sources can only be changed from the local EchisWorld installation.",
    storage_unreachable: "The local source registry is unavailable.",
  };
  if (messages[code]) return messages[code];
  if (code.startsWith("upstream_")) return `The source returned HTTP ${code.slice(9)}.`;
  return "The source could not be validated. Check the address and try again.";
}

export function PersonalSourceManager({ onCreated }: { onCreated: () => Promise<void> }) {
  const [open, setOpen] = useState(false);
  const [draft, setDraft] = useState<Draft>(INITIAL);
  const [probe, setProbe] = useState<Probe | null>(null);
  const [validatedSignature, setValidatedSignature] = useState("");
  const [busy, setBusy] = useState<"test" | "save" | null>(null);
  const [error, setError] = useState("");
  const signature = useMemo(() => JSON.stringify(draft), [draft]);
  const validated = Boolean(probe && signature === validatedSignature);

  const update = <K extends keyof Draft>(key: K, value: Draft[K]) => {
    setDraft((current) => ({ ...current, [key]: value }));
    setProbe(null);
    setError("");
  };

  const request = async (url: string) => {
    const response = await fetch(url, {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(draft),
    });
    const body = await response.json() as { error?: string; probe?: Probe };
    if (!response.ok) throw new Error(body.error || "validation_failed");
    return body;
  };

  const test = async () => {
    setBusy("test");
    setError("");
    try {
      const body = await request("/api/sources/personal/validate");
      setProbe(body.probe ?? null);
      setValidatedSignature(signature);
    } catch (reason) {
      setProbe(null);
      setError(errorMessage(reason instanceof Error ? reason.message : "validation_failed"));
    } finally {
      setBusy(null);
    }
  };

  const save = async () => {
    if (!validated) return;
    setBusy("save");
    setError("");
    try {
      await request("/api/sources/personal");
      await onCreated();
      setDraft(INITIAL);
      setProbe(null);
      setValidatedSignature("");
      setOpen(false);
    } catch (reason) {
      setError(errorMessage(reason instanceof Error ? reason.message : "create_failed"));
    } finally {
      setBusy(null);
    }
  };

  return (
    <>
      <button type="button" className={styles.trigger} onClick={() => setOpen(true)}>+ Add source</button>
      {open && (
        <div className={styles.backdrop} role="presentation" onMouseDown={(event) => {
          if (event.target === event.currentTarget && !busy) setOpen(false);
        }}>
          <section className={styles.dialog} role="dialog" aria-modal="true" aria-labelledby="personal-source-title">
            <header className={styles.header}>
              <div>
                <span className={styles.eyebrow}>Installation source</span>
                <h2 id="personal-source-title">Connect a personal source</h2>
                <p>The source stays on this EchisWorld installation. It is validated before the worker can collect it.</p>
              </div>
              <button type="button" className={styles.close} disabled={Boolean(busy)} onClick={() => setOpen(false)} aria-label="Close">×</button>
            </header>
            <div className={styles.form}>
              <label className={`${styles.field} ${styles.wide}`}><span>Source name</span><input value={draft.name} maxLength={120} onChange={(e) => update("name", e.target.value)} placeholder="Example Security Feed" /></label>
              <label className={styles.field}><span>Connection</span><select value={draft.connectorType} onChange={(e) => update("connectorType", e.target.value as Draft["connectorType"])}><option value="rss">RSS / Atom</option><option value="json">Public JSON API</option></select></label>
              <label className={styles.field}><span>Category</span><select value={draft.category} onChange={(e) => update("category", e.target.value as Draft["category"])}><option value="global">Global</option><option value="cyber">Cyber</option><option value="defense">Defense</option><option value="policy">Policy</option></select></label>
              <label className={`${styles.field} ${styles.wide}`}><span>HTTPS endpoint</span><input type="url" value={draft.endpoint} onChange={(e) => update("endpoint", e.target.value)} placeholder={draft.connectorType === "rss" ? "https://example.com/feed.xml" : "https://example.com/feed.json"} /></label>
              <label className={styles.field}><span>Language</span><select value={draft.language} onChange={(e) => update("language", e.target.value)}>{["en","tr","ar","fr","es","ru","de","sr","el","az","zh","vi"].map((value) => <option key={value} value={value}>{value.toUpperCase()}</option>)}</select></label>
              <label className={styles.field}><span>Region</span><select value={draft.regionScope} onChange={(e) => update("regionScope", e.target.value)}><option value="global">Global</option><option value="north_america">North America</option><option value="middle_east">Middle East</option><option value="europe">Europe</option><option value="asia_pacific">Asia Pacific</option><option value="americas">Americas</option><option value="africa">Africa</option></select></label>
              <p className={styles.hint}>No API keys are accepted here. JSON connections support JSON Feed and common public article envelopes.</p>
              {probe && validated && <div className={styles.result}><header><span>Connection verified</span><span>{probe.itemCount} items</span></header><div className={styles.samples}>{probe.samples.map((sample, index) => <div key={`${sample.title}-${index}`} title={sample.title}>{sample.title}</div>)}</div></div>}
              {error && <div className={styles.error}>{error}</div>}
            </div>
            <footer className={styles.actions}>
              <button type="button" disabled={Boolean(busy)} onClick={() => setOpen(false)}>Cancel</button>
              <button type="button" disabled={Boolean(busy) || !draft.name.trim() || !draft.endpoint.trim()} onClick={() => void test()}>{busy === "test" ? "Testing…" : "Test connection"}</button>
              <button type="button" className={styles.primary} disabled={Boolean(busy) || !validated} onClick={() => void save()}>{busy === "save" ? "Adding…" : "Add source"}</button>
            </footer>
          </section>
        </div>
      )}
    </>
  );
}

