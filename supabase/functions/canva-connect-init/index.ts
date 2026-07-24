// Server endpoint backing CanvaConnectButton.tsx's "Connect Canva" click.
// Identity is derived from the caller's own JWT (never trusted from the
// request body) and the PKCE-protected authUrl is built via the shared
// helper — see _shared/canva-oauth.ts for why this exists.
import { createClient } from 'https://esm.sh/@supabase/supabase-js@2';
import type { Database } from '../_shared/database.types.ts';
import { resolveCallerIdentity, initiateCanvaOAuth } from '../_shared/canva-oauth.ts';

function corsHeaders(): Record<string, string> {
  return {
    'Access-Control-Allow-Origin': '*',
    'Access-Control-Allow-Headers': 'authorization, x-client-info, apikey, content-type',
    'Content-Type': 'application/json',
  };
}

Deno.serve(async (req) => {
  if (req.method === 'OPTIONS') return new Response(null, { headers: corsHeaders() });

  let body: { returnUrl?: string };
  try {
    body = await req.json();
  } catch {
    return new Response(JSON.stringify({ error: 'Invalid JSON body' }), { status: 400, headers: corsHeaders() });
  }
  if (!body.returnUrl) {
    return new Response(JSON.stringify({ error: 'returnUrl is required' }), { status: 400, headers: corsHeaders() });
  }

  const identityResult = await resolveCallerIdentity(req);
  if (!identityResult.ok) {
    return new Response(JSON.stringify({ error: identityResult.error }), { status: identityResult.status, headers: corsHeaders() });
  }

  const serviceClient = createClient<Database>(
    Deno.env.get('SUPABASE_URL')!,
    Deno.env.get('SUPABASE_SERVICE_ROLE_KEY')!
  );

  const result = await initiateCanvaOAuth(serviceClient, {
    userId: identityResult.identity.userId,
    orgId: identityResult.identity.orgId,
    returnUrl: body.returnUrl,
  });

  if ('error' in result) {
    return new Response(JSON.stringify({ error: result.error }), { status: 500, headers: corsHeaders() });
  }

  return new Response(JSON.stringify({ authUrl: result.authUrl }), { headers: corsHeaders() });
});
