import { useState, useEffect, type ElementType } from "react";
import {
  Sun, Cloud, CloudSun, CloudFog, CloudDrizzle, CloudRain, CloudSnow, CloudLightning,
} from "lucide-react";
import { Card, CardContent } from "@/components/ui/card";
import { Badge } from "@/components/ui/badge";
import TVNoise from "@/components/ui/tv-noise";

/** Organisation timezone — matches the attendance subsystem (see api/client fmtAttendanceTime). */
const ORG_TZ = "America/New_York";

// New York City coordinates for the Open-Meteo current-weather query.
const NYC = { lat: 40.7128, lon: -74.006 };
const WEATHER_URL =
  `https://api.open-meteo.com/v1/forecast?latitude=${NYC.lat}&longitude=${NYC.lon}` +
  `&current=temperature_2m,weather_code&temperature_unit=fahrenheit&timezone=America%2FNew_York`;

interface Weather {
  temp: number;
  code: number;
}

/** Map a WMO weather code to a short label + icon. */
function describeWeather(code: number): { label: string; Icon: ElementType } {
  if (code === 0) return { label: "Clear", Icon: Sun };
  if (code === 1) return { label: "Mostly clear", Icon: Sun };
  if (code === 2) return { label: "Partly cloudy", Icon: CloudSun };
  if (code === 3) return { label: "Overcast", Icon: Cloud };
  if (code === 45 || code === 48) return { label: "Fog", Icon: CloudFog };
  if (code >= 51 && code <= 57) return { label: "Drizzle", Icon: CloudDrizzle };
  if (code >= 61 && code <= 67) return { label: "Rain", Icon: CloudRain };
  if (code >= 71 && code <= 77) return { label: "Snow", Icon: CloudSnow };
  if (code >= 80 && code <= 82) return { label: "Showers", Icon: CloudRain };
  if (code >= 85 && code <= 86) return { label: "Snow showers", Icon: CloudSnow };
  if (code >= 95) return { label: "Thunderstorm", Icon: CloudLightning };
  return { label: "—", Icon: Cloud };
}

/** Live clock + real New York City weather (right-rail). */
export default function Widget() {
  const [now, setNow] = useState(() => new Date());
  const [weather, setWeather] = useState<Weather | null>(null);

  // Tick the clock every second.
  useEffect(() => {
    const timer = setInterval(() => setNow(new Date()), 1000);
    return () => clearInterval(timer);
  }, []);

  // Fetch NYC weather on mount, then refresh every 15 minutes.
  useEffect(() => {
    const controller = new AbortController();
    const load = async () => {
      try {
        const res = await fetch(WEATHER_URL, { signal: controller.signal });
        if (!res.ok) return;
        const j = await res.json();
        const c = j?.current;
        if (c && typeof c.temperature_2m === "number") {
          setWeather({ temp: Math.round(c.temperature_2m), code: Number(c.weather_code) });
        }
      } catch {
        /* offline / blocked — keep showing the clock without weather */
      }
    };
    load();
    const id = setInterval(load, 15 * 60 * 1000);
    return () => { controller.abort(); clearInterval(id); };
  }, []);

  const time = new Intl.DateTimeFormat("en-US", {
    timeZone: ORG_TZ, hour12: true, hour: "numeric", minute: "2-digit",
  }).format(now);
  const dayOfWeek = new Intl.DateTimeFormat("en-US", { timeZone: ORG_TZ, weekday: "long" }).format(now);
  const restOfDate = new Intl.DateTimeFormat("en-US", {
    timeZone: ORG_TZ, year: "numeric", month: "long", day: "numeric",
  }).format(now);
  const tzLabel =
    new Intl.DateTimeFormat("en-US", { timeZone: ORG_TZ, timeZoneName: "short" })
      .formatToParts(now)
      .find((p) => p.type === "timeZoneName")?.value ?? "EST";

  const wx = weather ? describeWeather(weather.code) : null;
  const WxIcon = wx?.Icon;

  return (
    <Card className="w-full aspect-[2] relative overflow-hidden">
      <TVNoise opacity={0.3} intensity={0.2} speed={40} />
      <CardContent className="bg-accent/30 flex-1 flex flex-col justify-between text-sm font-medium uppercase relative z-20">
        <div className="flex justify-between items-center">
          <span className="opacity-50">{dayOfWeek}</span>
          <span>{restOfDate}</span>
        </div>

        <div className="text-center">
          <div className="text-5xl font-display" suppressHydrationWarning>
            {time}
          </div>
        </div>

        {/* Weather + location */}
        <div className="flex justify-between items-center">
          <span className="flex items-center gap-1.5 opacity-80">
            {WxIcon && <WxIcon className="size-4" aria-hidden />}
            {weather ? `${weather.temp}°F` : "—"}
            {wx && wx.label !== "—" && <span className="opacity-50">· {wx.label}</span>}
          </span>
          <span className="flex items-center gap-2">
            <span className="opacity-50">New York</span>
            <Badge variant="secondary" className="bg-accent">{tzLabel}</Badge>
          </span>
        </div>

        <div className="absolute inset-0 -z-[1]">
          <img
            src="/assets/pc_blueprint.gif"
            alt=""
            aria-hidden
            width={250}
            height={250}
            className="size-full object-contain"
          />
        </div>
      </CardContent>
    </Card>
  );
}
