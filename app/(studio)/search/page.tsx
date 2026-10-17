import Link from "next/link";
import { studio } from "../context";
import { search } from "@/src/application/views";
import { PageHead, StateBadge } from "@/components/Tabs";

export default async function Search({ searchParams }: { searchParams: Promise<{ q?: string }> }) {
  const q = ((await searchParams).q ?? "").trim().slice(0, 100);
  const { actor, ws } = await studio();
  const rows = q ? await search(actor, ws, q) : [];
  return (
    <div className="p-4 md:p-6 max-w-3xl">
      <PageHead title="Search" sub="Your campaigns and posts in this workspace" />
      <form role="search" className="flex gap-2"><label htmlFor="q" className="sr-only">Search</label><input id="q" name="q" defaultValue={q} className="field" placeholder="Caption, title or campaign" /><button className="btn">Search</button></form>
      <ul className="card divide-y divide-line mt-4">{rows.map((r: any) => (
        <li key={r.variant_id}><Link href={`/posts/${r.variant_id}`} className="p-3 block hover:bg-panel-2"><span className="flex justify-between gap-2"><span className="font-medium">{r.concept}</span><StateBadge state={r.editorial_state} /></span>
          <span className="text-sm text-muted line-clamp-1">{r.campaign} · {r.platform} · {r.caption}</span></Link></li>))}
        {q && !rows.length && <li className="p-3 text-sm text-muted">No matches.</li>}</ul>
    </div>
  );
}
