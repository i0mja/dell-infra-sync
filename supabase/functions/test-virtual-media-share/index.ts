import "https://deno.land/x/xhr@0.1.0/mod.ts";
import { serve } from "https://deno.land/std@0.168.0/http/server.ts";
import { createClient } from "https://esm.sh/@supabase/supabase-js@2.39.3";

const corsHeaders = {
  "Access-Control-Allow-Origin": "*",
  "Access-Control-Allow-Headers": "authorization, x-client-info, apikey, content-type",
};

interface ShareTestRequest {
  host?: string;
  export_path?: string;
  iso_path?: string;
  share_type?: "nfs" | "cifs" | "http" | "https";
  use_auth?: boolean;
  username?: string;
  password?: string;
  list_files?: boolean;
}

type ShareType = "nfs" | "cifs" | "http" | "https";

interface TestResult {
  success: boolean;
  latency_ms?: number;
  error?: string;
  port?: number;
}

async function testPortReachability(host: string, port: number, timeoutMs = 5000): Promise<TestResult> {
  const start = Date.now();
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), timeoutMs);

  try {
    const connection = await Deno.connect({ hostname: host, port, signal: controller.signal });
    connection.close();
    clearTimeout(timeout);
    return { success: true, latency_ms: Date.now() - start, port };
  } catch (error) {
    clearTimeout(timeout);
    return {
      success: false,
      error: error instanceof Error ? error.message : "Unable to reach port",
      port,
    };
  }
}

function buildBaseUrl(host: string, shareType: ShareType, exportPath?: string, isoPath?: string) {
  const scheme = shareType;
  const cleanExport = (exportPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
  const cleanIso = (isoPath || "").replace(/^\/+/, "").replace(/\/+$/, "");
  const joinedPath = [cleanExport, cleanIso].filter(Boolean).join("/");
  return `${scheme}://${host}${joinedPath ? `/${joinedPath}` : ""}`;
}

async function fetchHttpDirectory(url: string, auth?: { username?: string; password?: string }) {
  const headers: HeadersInit = {};
  if (auth?.username && auth.password) {
    headers["Authorization"] = "Basic " + btoa(`${auth.username}:${auth.password}`);
  }

  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), 8000);

  try {
    const response = await fetch(url, { headers, signal: controller.signal });
    clearTimeout(timeout);

    if (!response.ok) {
      return { files: [], error: `HTTP ${response.status} when fetching directory` };
    }

    const body = await response.text();
    const fileMatches = [...body.matchAll(/href=\"([^\"]+)\"/gi)]
      .map(match => decodeURIComponent(match[1]))
      .filter(name => /\.(iso|img)$/i.test(name));

    return { files: Array.from(new Set(fileMatches)), error: undefined };
  } catch (error) {
    clearTimeout(timeout);
    return { files: [], error: error instanceof Error ? error.message : "Failed to list directory" };
  }
}

serve(async (req) => {
  if (req.method === "OPTIONS") {
    return new Response(null, { headers: corsHeaders });
  }

  try {
    const supabaseUrl = Deno.env.get("SUPABASE_URL")!;
    const supabaseServiceKey = Deno.env.get("SUPABASE_SERVICE_ROLE_KEY")!;
    const authHeader = req.headers.get("Authorization") || "";

    let userId: string;
    try {
      const token = authHeader.replace("Bearer ", "");
      if (!token) throw new Error("No token provided");
      const payload = JSON.parse(atob(token.split(".")[1]));
      userId = payload.sub;
      if (!userId) throw new Error("Invalid token payload");
    } catch (error) {
      console.error("Token extraction failed:", error);
      return new Response(JSON.stringify({ error: "Unauthorized" }), {
        status: 401,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const supabaseAdmin = createClient(supabaseUrl, supabaseServiceKey);

    // Role check: admin or operator
    const { data: isAdmin } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "admin" });
    const { data: isOperator } = await supabaseAdmin.rpc("has_role", { _user_id: userId, _role: "operator" });

    if (!isAdmin && !isOperator) {
      return new Response(JSON.stringify({ error: "Insufficient permissions" }), {
        status: 403,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const requestData: ShareTestRequest = req.method === "POST" ? await req.json() : {};

    // If host not provided, fall back to saved settings
    let host = requestData.host;
    let exportPath = requestData.export_path;
    let isoPath = requestData.iso_path;
    let shareType: ShareType = (requestData.share_type || "nfs") as ShareType;
    let username = requestData.username;
    let password = requestData.password;
    const listFiles = requestData.list_files ?? true;

    if (!host) {
      const { data: settings } = await supabaseAdmin
        .from("virtual_media_settings")
        .select("host, export_path, iso_path, share_type, username, password, use_auth")
        .maybeSingle();

      if (!settings?.host) {
        return new Response(JSON.stringify({ error: "Virtual media settings not configured" }), {
          status: 400,
          headers: { ...corsHeaders, "Content-Type": "application/json" },
        });
      }

      host = settings.host;
      exportPath = exportPath ?? settings.export_path ?? "";
      isoPath = isoPath ?? settings.iso_path ?? "";
      shareType = (settings.share_type || "nfs") as ShareType;
      if (settings.use_auth) {
        username = username ?? settings.username;
        password = password ?? settings.password;
      }
    }

    if (!host) {
      return new Response(JSON.stringify({ error: "host is required" }), {
        status: 400,
        headers: { ...corsHeaders, "Content-Type": "application/json" },
      });
    }

    const targetHost = host.trim();
    const defaultPort = shareType === "nfs" ? 2049 : shareType === "cifs" ? 445 : shareType === "https" ? 443 : 80;
    const portTest = await testPortReachability(targetHost, defaultPort);

    const baseUrl = buildBaseUrl(targetHost, shareType, exportPath, isoPath);
    let files: string[] = [];
    let listingError: string | undefined;

    if ((shareType === "http" || shareType === "https") && portTest.success && listFiles) {
      const directoryResult = await fetchHttpDirectory(baseUrl, { username, password });
      files = directoryResult.files;
      listingError = directoryResult.error;
    }

    const responsePayload = {
      success: portTest.success,
      port: defaultPort,
      latency_ms: portTest.latency_ms,
      error: portTest.error,
      base_url: baseUrl,
      files,
      listing_error: listingError,
    };

    return new Response(JSON.stringify(responsePayload), {
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  } catch (error) {
    console.error("Virtual media share test error:", error);
    return new Response(JSON.stringify({ error: error instanceof Error ? error.message : "Internal error" }), {
      status: 500,
      headers: { ...corsHeaders, "Content-Type": "application/json" },
    });
  }
});
