"use client";

import { useState, useEffect } from "react";
import { useRouter } from "next/navigation";
import Image from "next/image";

type Batch = { id: string; name: string };

const THEME = { green: "#7BBA27", greenDark: "#5C9420", navy: "#0B1D2E", bg: "#F5F6F1", border: "#E4E1D8", textMuted: "#6B6A63" };

export default function LoginPage() {
  const router = useRouter();
  const [checkedSession, setCheckedSession] = useState(false);
  const [batches, setBatches] = useState<Batch[]>([]);
  const [selectedBatchId, setSelectedBatchId] = useState<string | null>(null);
  const [addingBatch, setAddingBatch] = useState(false);
  const [newBatchName, setNewBatchName] = useState("");

  const [role, setRole] = useState<"faculty" | "admin" | "student">("faculty");
  const [username, setUsername] = useState("");
  const [password, setPassword] = useState("");
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(false);

  useEffect(() => {
    fetch("/api/auth/me").then((r) => r.json()).then((d) => {
      if (d.user) { router.replace("/dashboard"); return; }
      setCheckedSession(true);
    });
    fetch("/api/batches").then((r) => r.json()).then((d) => setBatches(d.batches || []));
    const saved = typeof window !== "undefined" ? localStorage.getItem("ffoi_batch_id") : null;
    if (saved) setSelectedBatchId(saved);
  }, [router]);

  function selectBatch(id: string) {
    setSelectedBatchId(id);
    if (typeof window !== "undefined") localStorage.setItem("ffoi_batch_id", id);
  }

  async function addBatch() {
    if (!newBatchName.trim()) return;
    const res = await fetch("/api/batches", { method: "POST", headers: { "Content-Type": "application/json" }, body: JSON.stringify({ name: newBatchName.trim() }) });
    const data = await res.json();
    if (res.ok) {
      setBatches((b) => [...b, data.batch]);
      setNewBatchName("");
      setAddingBatch(false);
    }
  }

  async function handleSubmit(e: React.FormEvent) {
    e.preventDefault();
    setError("");
    setLoading(true);
    try {
      const res = await fetch("/api/auth/login", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ username, password, role }),
      });
      const data = await res.json();
      if (!res.ok) {
        setError(data.error || "Login failed.");
        setLoading(false);
        return;
      }
      router.push("/dashboard");
    } catch {
      setError("Something went wrong. Please try again.");
      setLoading(false);
    }
  }

  if (!checkedSession) {
    return <div className="flex items-center justify-center min-h-screen" style={{ color: THEME.textMuted }}>Loading...</div>;
  }

  if (!selectedBatchId) {
    return (
      <div className="flex items-center justify-center min-h-screen p-5" style={{ background: `linear-gradient(160deg, ${THEME.green} 0%, #4E7A1E 55%, ${THEME.navy} 100%)` }}>
        <div style={{ width: 460 }} className="text-center">
          <div className="w-[76px] h-[76px] rounded-2xl bg-white flex items-center justify-center mx-auto mb-4">
            <Image src="/ffoi-logo.png" alt="FFOI logo" width={50} height={50} />
          </div>
          <div className="text-2xl font-bold text-white mb-1">Finance Forum of India</div>
          <div className="text-sm text-white/85 mb-7">Select your batch to continue</div>

          <div className="flex flex-col gap-3">
            {batches.map((b) => (
              <button key={b.id} onClick={() => selectBatch(b.id)}
                className="flex items-center justify-between px-5 py-4 rounded-2xl bg-white shadow-lg text-left">
                <span className="text-[15.5px] font-semibold" style={{ color: THEME.navy }}>{b.name}</span>
                <span style={{ color: THEME.green }}>→</span>
              </button>
            ))}

            {addingBatch ? (
              <div className="flex gap-2 p-2.5 rounded-2xl bg-white/10">
                <input value={newBatchName} onChange={(e) => setNewBatchName(e.target.value)} autoFocus placeholder="New batch name"
                  onKeyDown={(e) => { if (e.key === "Enter") addBatch(); }}
                  className="flex-1 px-3 py-2.5 rounded-lg text-sm" />
                <button onClick={addBatch} className="px-4 py-2.5 rounded-lg font-semibold text-white" style={{ background: THEME.green }}>Add</button>
                <button onClick={() => { setAddingBatch(false); setNewBatchName(""); }} className="px-3 py-2.5 rounded-lg text-white bg-white/20">Cancel</button>
              </div>
            ) : (
              <button onClick={() => setAddingBatch(true)}
                className="flex items-center justify-center gap-2 px-5 py-4 rounded-2xl border-2 border-dashed border-white/50 text-white">
                <span className="text-sm font-semibold">+ Add a new batch</span>
              </button>
            )}
          </div>
        </div>
      </div>
    );
  }

  const batchName = batches.find((b) => b.id === selectedBatchId)?.name;

  return (
    <div className="flex flex-1 items-center justify-center min-h-screen p-5" style={{ background: `linear-gradient(160deg, ${THEME.green} 0%, #4E7A1E 55%, ${THEME.navy} 100%)` }}>
      <div className="w-[380px] p-9 rounded-2xl bg-white shadow-2xl">
        <div className="flex flex-col items-center gap-3 mb-6">
          <div className="w-[68px] h-[68px] rounded-2xl flex items-center justify-center" style={{ background: THEME.bg }}>
            <Image src="/ffoi-logo.png" alt="FFOI logo" width={44} height={44} />
          </div>
          <div className="text-lg font-bold text-center" style={{ color: THEME.navy }}>Finance Forum of India</div>
          <div className="text-sm text-center" style={{ color: THEME.textMuted }}>Weekly plan &amp; progress portal</div>
          <div className="flex items-center gap-1.5 px-3 py-1 rounded-full" style={{ background: "#EAF5DA" }}>
            <span className="text-xs font-semibold" style={{ color: THEME.greenDark }}>{batchName}</span>
            <button onClick={() => setSelectedBatchId(null)} className="text-[11px] underline" style={{ color: THEME.greenDark }}>change</button>
          </div>
        </div>

        <div className="flex gap-1 mb-6 bg-[#F0EEE6] p-1.5 rounded-lg">
          {(["faculty", "admin", "student"] as const).map((r) => (
            <button key={r} type="button" onClick={() => setRole(r)}
              className="flex-1 py-2 text-sm rounded-md transition-colors font-medium"
              style={{ background: role === r ? THEME.green : "transparent", color: role === r ? "#fff" : THEME.textMuted }}>
              {r === "admin" ? "Admin" : r === "faculty" ? "Faculty" : "Student"}
            </button>
          ))}
        </div>

        <form onSubmit={handleSubmit}>
          <label className="text-xs font-semibold" style={{ color: THEME.navy }}>Username</label>
          <input value={username} onChange={(e) => setUsername(e.target.value)} autoComplete="username"
            className="w-full px-3.5 py-3 mt-1.5 mb-4 rounded-lg text-sm outline-none border-2 border-[#D8D4C6] focus:border-green-600" />
          <label className="text-xs font-semibold" style={{ color: THEME.navy }}>Password</label>
          <input type="password" value={password} onChange={(e) => setPassword(e.target.value)} autoComplete="current-password"
            className="w-full px-3.5 py-3 mt-1.5 mb-5 rounded-lg text-sm outline-none border-2 border-[#D8D4C6] focus:border-green-600" />
          {error && <div className="text-sm mb-3.5 px-3 py-2 rounded-lg" style={{ color: "#A32D2D", background: "#FCEBEB" }}>{error}</div>}
          <button type="submit" disabled={loading}
            className="w-full py-3 rounded-lg text-white text-[15px] font-bold disabled:opacity-60" style={{ background: THEME.green }}>
            {loading ? "Logging in..." : "Log in"}
          </button>
        </form>
      </div>
    </div>
  );
}
