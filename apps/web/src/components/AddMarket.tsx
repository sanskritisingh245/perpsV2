import { useState } from "react";
import { createMarket } from "../api";
import { useMarkets, useToast } from "../state";

// Two ways to register a market locally (the backend has no list endpoint):
//  - Create: calls POST /admin/market with the ADMIN_SECRET and stores the result.
//  - Existing: paste a known market id + slug to track it.
export function AddMarket({ onClose }: { onClose: () => void }) {
  const { add } = useMarkets();
  const { push } = useToast();
  const [mode, setMode] = useState<"create" | "existing">("create");
  const [closing, setClosing] = useState(false);

  // play the exit animation, then actually close
  const close = () => { setClosing(true); setTimeout(onClose, 180); };

  const [slug, setSlug] = useState("");
  const [imageUrl, setImageUrl] = useState("");
  const [secret, setSecret] = useState("");
  const [id, setId] = useState("");
  const [busy, setBusy] = useState(false);

  async function submit() {
    setBusy(true);
    try {
      if (mode === "create") {
        if (!slug || !secret) throw new Error("Slug and admin secret required");
        const res = await createMarket(slug, imageUrl, secret);
        add(res.data);
        push("ok", `Market ${res.data.slug} created`);
      } else {
        if (!id || !slug) throw new Error("Market id and slug required");
        add({ id, slug, imageUrl });
        push("ok", `Tracking ${slug}`);
      }
      close();
    } catch (e: any) {
      push("err", e.message === "FORBIDDEN" ? "Wrong admin secret" : e.message);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className={"overlay" + (closing ? " closing" : "")} onMouseDown={close}>
      <div className={"modal" + (closing ? " closing" : "")} onMouseDown={(e) => e.stopPropagation()}>
        <h3>Add market</h3>
        <div className="seg" style={{ marginBottom: 16 }}>
          <button className={mode === "create" ? "on" : ""} onClick={() => setMode("create")}>
            Create (admin)
          </button>
          <button className={mode === "existing" ? "on" : ""} onClick={() => setMode("existing")}>
            Add existing
          </button>
        </div>

        {mode === "create" ? (
          <>
            <Input label="Slug" value={slug} onChange={setSlug} placeholder="BTC-PERP" />
            <Input label="Image URL (optional)" value={imageUrl} onChange={setImageUrl} placeholder="https://…" />
            <Input label="Admin secret" value={secret} onChange={setSecret} placeholder="ADMIN_SECRET" type="password" />
          </>
        ) : (
          <>
            <Input label="Market id" value={id} onChange={setId} placeholder="uuid from /api/order response" />
            <Input label="Slug" value={slug} onChange={setSlug} placeholder="BTC-PERP" />
            <Input label="Image URL (optional)" value={imageUrl} onChange={setImageUrl} placeholder="https://…" />
          </>
        )}

        <div className="row gap" style={{ justifyContent: "flex-end", marginTop: 18 }}>
          <button className="btn ghost" onClick={close}>Cancel</button>
          <button className="btn gold" onClick={submit} disabled={busy}>
            {busy ? "Saving…" : "Save"}
          </button>
        </div>
      </div>
    </div>
  );
}

function Input({
  label, value, onChange, placeholder, type,
}: {
  label: string; value: string; onChange: (v: string) => void; placeholder?: string; type?: string;
}) {
  return (
    <div className="field" style={{ marginBottom: 12 }}>
      <label>{label}</label>
      <div className="input">
        <input
          type={type ?? "text"}
          value={value}
          placeholder={placeholder}
          onChange={(e) => onChange(e.target.value)}
        />
      </div>
    </div>
  );
}
