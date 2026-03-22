import { useState, useEffect } from "react";
import {
  Field,
  Label,
  Input,
  Description,
  Fieldset,
  Legend,
} from "@headlessui/react";
import { Save, Eye, EyeOff, CheckCircle2 } from "lucide-react";
import type { OssConfig, WatermarkConfig } from "../lib/tauri";

interface Props {
  ossConfig: OssConfig | null;
  onSaveOss: (oss: OssConfig) => Promise<void>;
  watermarkConfig: WatermarkConfig | null;
  onSaveWatermark: (wm: WatermarkConfig) => Promise<void>;
}

export default function SettingsPanel({ ossConfig, onSaveOss, watermarkConfig, onSaveWatermark }: Props) {
  const [oss, setOss] = useState<OssConfig>({
    access_key_id: "",
    access_key_secret: "",
    endpoint: "",
    bucket: "",
    region: "",
    path_prefix: "",
    custom_domain: null,
  });

  const [wm, setWm] = useState<WatermarkConfig>({
    content: "",
    strength: "low",
    quality: 90,
  });

  useEffect(() => {
    if (watermarkConfig) setWm(watermarkConfig);
  }, [watermarkConfig]);

  const [showSecret, setShowSecret] = useState(false);
  const [saving, setSaving] = useState(false);
  const [message, setMessage] = useState<{
    type: "success" | "error";
    text: string;
  } | null>(null);

  useEffect(() => {
    if (ossConfig) setOss(ossConfig);
  }, [ossConfig]);

  async function handleSaveOss() {
    setSaving(true);
    setMessage(null);
    try {
      await onSaveOss({
        ...oss,
        path_prefix: oss.path_prefix || null,
        custom_domain: oss.custom_domain || null,
      });
      setMessage({ type: "success", text: "OSS 配置已保存" });
      setTimeout(() => setMessage(null), 3000);
    } catch (e) {
      setMessage({ type: "error", text: String(e) });
    } finally {
      setSaving(false);
    }
  }

  const inputClass =
    "mt-1 block w-full rounded-lg border border-zinc-300 bg-white px-3 py-2 text-sm text-zinc-900 shadow-sm transition focus:border-primary-500 focus:ring-2 focus:ring-primary-500/20 focus:outline-none dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-100";

  return (
    <div className="flex h-full flex-col gap-4">
      {/* Toast */}
      {message && (
        <div
          className={`flex items-center gap-2 rounded-lg px-4 py-2.5 text-sm font-medium ${
            message.type === "success"
              ? "bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-400"
              : "bg-red-50 text-red-700 dark:bg-red-900/30 dark:text-red-400"
          }`}
        >
          {message.type === "success" && <CheckCircle2 className="h-4 w-4" />}
          {message.text}
        </div>
      )}

      {/* OSS Config */}
      <Fieldset className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700/60 dark:bg-zinc-900">
        <Legend className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 px-1">
          阿里云 OSS 连接
        </Legend>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field className="col-span-2 sm:col-span-1">
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Access Key ID
            </Label>
            <Input
              className={inputClass}
              value={oss.access_key_id}
              onChange={(e) =>
                setOss((p) => ({ ...p, access_key_id: e.target.value }))
              }
              placeholder="LTAI5t..."
            />
          </Field>

          <Field className="col-span-2 sm:col-span-1">
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Access Key Secret
            </Label>
            <div className="relative">
              <Input
                type={showSecret ? "text" : "password"}
                className={inputClass + " pr-10"}
                value={oss.access_key_secret}
                onChange={(e) =>
                  setOss((p) => ({
                    ...p,
                    access_key_secret: e.target.value,
                  }))
                }
                placeholder="••••••••"
              />
              <button
                type="button"
                onClick={() => setShowSecret(!showSecret)}
                className="absolute right-2 top-1/2 -translate-y-1/2 mt-0.5 p-1 text-zinc-400 hover:text-zinc-600 dark:hover:text-zinc-300"
              >
                {showSecret ? (
                  <EyeOff className="h-4 w-4" />
                ) : (
                  <Eye className="h-4 w-4" />
                )}
              </button>
            </div>
          </Field>

          <Field>
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Endpoint
            </Label>
            <Input
              className={inputClass}
              value={oss.endpoint}
              onChange={(e) =>
                setOss((p) => ({ ...p, endpoint: e.target.value }))
              }
              placeholder="oss-cn-hangzhou.aliyuncs.com"
            />
          </Field>

          <Field>
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Bucket
            </Label>
            <Input
              className={inputClass}
              value={oss.bucket}
              onChange={(e) =>
                setOss((p) => ({ ...p, bucket: e.target.value }))
              }
              placeholder="my-bucket"
            />
          </Field>

          <Field>
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              Region
            </Label>
            <Input
              className={inputClass}
              value={oss.region}
              onChange={(e) =>
                setOss((p) => ({ ...p, region: e.target.value }))
              }
              placeholder="cn-hangzhou"
            />
          </Field>

          <Field>
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              路径前缀
            </Label>
            <Input
              className={inputClass}
              value={oss.path_prefix ?? ""}
              onChange={(e) =>
                setOss((p) => ({ ...p, path_prefix: e.target.value }))
              }
              placeholder="images/"
            />
            <Description className="mt-1 text-xs text-zinc-500">
              可选，上传文件的 OSS 路径前缀
            </Description>
          </Field>

          <Field className="col-span-2">
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              自定义域名
            </Label>
            <Input
              className={inputClass}
              value={oss.custom_domain ?? ""}
              onChange={(e) =>
                setOss((p) => ({ ...p, custom_domain: e.target.value }))
              }
              placeholder="img.example.com"
            />
            <Description className="mt-1 text-xs text-zinc-500">
              可选，在 OSS 控制台绑定的自定义域名，用于生成外链
            </Description>
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={handleSaveOss}
            disabled={saving || !oss.access_key_id || !oss.access_key_secret || !oss.endpoint || !oss.bucket || !oss.region}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-4 w-4" />
            {saving ? "保存中..." : "保存配置"}
          </button>
        </div>
      </Fieldset>
      {/* Watermark Config */}
      <Fieldset className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700/60 dark:bg-zinc-900">
        <Legend className="text-sm font-semibold text-zinc-900 dark:text-zinc-100 px-1">
          默认水印设置
        </Legend>

        <div className="mt-4 grid grid-cols-2 gap-4">
          <Field className="col-span-2">
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              水印文本
            </Label>
            <Input
              className={inputClass}
              value={wm.content}
              onChange={(e) => setWm((p) => ({ ...p, content: e.target.value }))}
              placeholder="版权所有CloudMark"
            />
            <Description className="mt-1 text-xs text-zinc-500">
              添加水印时的默认文本内容
            </Description>
          </Field>

          <Field>
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              默认强度
            </Label>
            <select
              value={wm.strength}
              onChange={(e) => setWm((p) => ({ ...p, strength: e.target.value }))}
              className={inputClass}
            >
              <option value="low">低</option>
              <option value="medium">中</option>
              <option value="high">高</option>
            </select>
          </Field>

          <Field>
            <Label className="text-xs font-medium text-zinc-600 dark:text-zinc-400">
              JPEG 质量
            </Label>
            <Input
              type="number"
              min={70}
              max={100}
              className={inputClass}
              value={wm.quality ?? 90}
              onChange={(e) => setWm((p) => ({ ...p, quality: Number(e.target.value) || 90 }))}
            />
            <Description className="mt-1 text-xs text-zinc-500">
              70-100，仅影响 JPEG 输出
            </Description>
          </Field>
        </div>

        <div className="mt-5 flex justify-end">
          <button
            onClick={async () => {
              setSaving(true);
              setMessage(null);
              try {
                await onSaveWatermark(wm);
                setMessage({ type: "success", text: "水印设置已保存" });
                setTimeout(() => setMessage(null), 3000);
              } catch (e) {
                setMessage({ type: "error", text: String(e) });
              } finally {
                setSaving(false);
              }
            }}
            disabled={saving}
            className="inline-flex items-center gap-1.5 rounded-lg bg-primary-600 px-4 py-2 text-sm font-medium text-white shadow-sm transition hover:bg-primary-700 disabled:opacity-50 disabled:cursor-not-allowed"
          >
            <Save className="h-4 w-4" />
            {saving ? "保存中..." : "保存水印设置"}
          </button>
        </div>
      </Fieldset>
    </div>
  );
}
