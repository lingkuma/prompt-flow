import { Eye, EyeOff, Plus, Settings2, Trash2, X } from "lucide-react";
import { useEffect, useState } from "react";
import { createModelProfile, type ModelProfile } from "./modelProfiles";

export function ModelSettingsDialog({
  profiles,
  onSave,
  onClose,
}: {
  profiles: ModelProfile[];
  onSave: (profiles: ModelProfile[]) => void;
  onClose: () => void;
}) {
  const [drafts, setDrafts] = useState<ModelProfile[]>(() => structuredClone(profiles));
  const [selectedId, setSelectedId] = useState(profiles[0]?.id ?? "");
  const [showApiKey, setShowApiKey] = useState(false);
  const selected = drafts.find((profile) => profile.id === selectedId) ?? drafts[0];

  useEffect(() => {
    const onKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") onClose();
    };
    window.addEventListener("keydown", onKeyDown);
    return () => window.removeEventListener("keydown", onKeyDown);
  }, [onClose]);

  const updateSelected = (updater: (profile: ModelProfile) => void) => {
    setDrafts((current) => current.map((profile) => {
      if (profile.id !== selected?.id) return profile;
      const next = { ...profile };
      updater(next);
      return next;
    }));
  };

  const addProfile = () => {
    const profile = createModelProfile(drafts.length + 1);
    setDrafts((current) => [...current, profile]);
    setSelectedId(profile.id);
  };

  const deleteProfile = () => {
    if (!selected || drafts.length <= 1) return;
    const index = drafts.findIndex((profile) => profile.id === selected.id);
    const next = drafts.filter((profile) => profile.id !== selected.id);
    setDrafts(next);
    setSelectedId(next[Math.min(index, next.length - 1)].id);
  };

  return (
    <div className="dialogBackdrop" role="presentation" onMouseDown={(event) => {
      if (event.target === event.currentTarget) onClose();
    }}>
      <section className="modelSettingsDialog" role="dialog" aria-modal="true" aria-labelledby="model-settings-title">
        <header className="dialogHeader">
          <div>
            <h2 id="model-settings-title"><Settings2 size={19} /> 模型设置</h2>
            <p>保存多个 OpenAI 兼容 API 配置，在对话测试台中按列选择。</p>
          </div>
          <button className="iconButton" title="关闭" onClick={onClose}><X size={18} /></button>
        </header>
        <div className="modelSettingsBody">
          <aside className="modelProfileList">
            <div className="modelProfileListHeader">
              <strong>模型配置</strong>
              <button title="新增模型配置" onClick={addProfile}><Plus size={15} /></button>
            </div>
            {drafts.map((profile) => (
              <button
                key={profile.id}
                className={profile.id === selected?.id ? "modelProfileItem active" : "modelProfileItem"}
                onClick={() => setSelectedId(profile.id)}
              >
                <strong>{profile.name || "未命名配置"}</strong>
                <span>{profile.model || "未设置模型"}</span>
              </button>
            ))}
          </aside>
          {selected && (
            <div className="modelProfileForm">
              <label>配置名称
                <input value={selected.name} onChange={(event) => updateSelected((profile) => { profile.name = event.target.value; })} placeholder="例如：OpenAI 正式环境" />
              </label>
              <label>Base URL
                <input value={selected.baseUrl} onChange={(event) => updateSelected((profile) => { profile.baseUrl = event.target.value; })} placeholder="https://api.openai.com/v1" />
                <span className="fieldHelp">可填写到 /v1；如果已经包含 /chat/completions，也会直接使用。</span>
              </label>
              <label>API Key
                <div className="secretInput">
                  <input
                    type={showApiKey ? "text" : "password"}
                    value={selected.apiKey}
                    onChange={(event) => updateSelected((profile) => { profile.apiKey = event.target.value; })}
                    placeholder="sk-..."
                    autoComplete="off"
                  />
                  <button title={showApiKey ? "隐藏 API Key" : "显示 API Key"} onClick={() => setShowApiKey((value) => !value)}>
                    {showApiKey ? <EyeOff size={16} /> : <Eye size={16} />}
                  </button>
                </div>
                <span className="fieldHelp">仅保存在当前浏览器 localStorage，不会写入 workflow 或分享链接。</span>
              </label>
              <div className="twoCols">
                <label>模型名称
                  <input value={selected.model} onChange={(event) => updateSelected((profile) => { profile.model = event.target.value; })} placeholder="gpt-4.1-mini" />
                </label>
                <label>Temperature
                  <input
                    type="number"
                    min="0"
                    max="2"
                    step="0.1"
                    value={selected.temperature}
                    onChange={(event) => updateSelected((profile) => { profile.temperature = Math.min(2, Math.max(0, Number(event.target.value) || 0)); })}
                  />
                </label>
              </div>
              <button className="textDanger" disabled={drafts.length <= 1} onClick={deleteProfile}><Trash2 size={15} /> 删除这个配置</button>
            </div>
          )}
        </div>
        <footer className="dialogFooter">
          <button onClick={onClose}>取消</button>
          <button className="primaryButton" onClick={() => {
            onSave(drafts.map((profile, index) => ({
              ...profile,
              name: profile.name.trim() || `模型配置 ${index + 1}`,
              baseUrl: profile.baseUrl.trim(),
              model: profile.model.trim(),
            })));
            onClose();
          }}>保存设置</button>
        </footer>
      </section>
    </div>
  );
}
