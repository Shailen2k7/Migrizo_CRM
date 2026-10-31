import { requireUser } from "@/lib/auth";
import { PageTitle, Icon } from "@/components/ui";
import { SettingsForm } from "@/components/settings-form";
import { checkAI } from "@/lib/ai/provider";
import { WipeDataCard } from "./wipe-data";

export const dynamic = "force-dynamic";

export default async function AdminSettingsPage() {
  const user = await requireUser("ADMIN");
  const health = await checkAI();
  const ai = health.ok;
  const tts = Boolean(process.env.ELEVENLABS_API_KEY);

  return (
    <div>
      <PageTitle title="Settings" subtitle="Account and platform status." />
      <div className="mb-6 grid max-w-lg gap-3">
        <div className={`flex items-center gap-3 rounded-14 border p-4 ${ai ? "border-[#d7f5e6] bg-[#f4fdf8]" : "border-[#f4e3c2] bg-[#fdf8ec]"}`}>
          <Icon name="smart_toy" className={`text-[20px] ${ai ? "text-green-deep" : "text-amber-deep"}`} />
          <div className="text-13">
            <div className="font-bold text-ink">AI engine</div>
            <div className="text-muted">
              {ai ? health.detail : `${health.detail}. CV import and Maya are using basic fallbacks.`}
            </div>
          </div>
        </div>
        <div className={`flex items-center gap-3 rounded-14 border p-4 ${tts ? "border-[#d7f5e6] bg-[#f4fdf8]" : "border-[#f4e3c2] bg-[#fdf8ec]"}`}>
          <Icon name="graphic_eq" className={`text-[20px] ${tts ? "text-green-deep" : "text-amber-deep"}`} />
          <div className="text-13">
            <div className="font-bold text-ink">Voice (ElevenLabs)</div>
            <div className="text-muted">
              {tts ? "Connected, Maya speaks with premium voice" : "No key, browser voice fallback"}
            </div>
          </div>
        </div>
      </div>
      <SettingsForm name={user.name} email={user.email} />
      <WipeDataCard />
    </div>
  );
}
