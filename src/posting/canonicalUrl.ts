/** Query parameters that only carry tracking/attribution, never identify the job. */
const TRACKING_PARAMS: RegExp[] = [
  /^utm_/i,
  /^gh_src$/i,
  /^lever-(source|origin|via)$/i,
  /^(fbclid|gclid|msclkid|igshid|dclid|yclid)$/i,
  /^mc_(cid|eid)$/i,
  /^_hs(enc|mi)$/i,
  /^(ref|referrer|referer|refid|referral|source|src|trk|trackingid|trackid|tracking|campaign|cid|sid|li_fat_id|ebp|vs|jobboard|jb|rx_[a-z_]+)$/i,
];

// Array-style params ("lever-source[]") are tracking too.
const isTracking = (name: string) => TRACKING_PARAMS.some((re) => re.test(name.replace(/\[\]$/, '')));

/** Strip the application-form suffix so the URL points at the posting itself. */
function postingPath(host: string, path: string, params: URLSearchParams): { path: string; host?: string } {
  // Lever: /{company}/{id}/apply
  if (host === 'jobs.lever.co') return { path: path.replace(/\/apply$/i, '') };
  // Ashby: /{company}/{id}/application
  if (host === 'jobs.ashbyhq.com') return { path: path.replace(/\/application$/i, '') };
  // Greenhouse embed iframe: /embed/job_app?for=co&token=id → /co/jobs/id
  if (/(^|\.)greenhouse\.io$/.test(host) && /^\/embed\/job_app/i.test(path)) {
    const co = params.get('for');
    const id = params.get('token');
    if (co && id) {
      params.delete('for');
      params.delete('token');
      return { path: `/${co}/jobs/${id}`, host: 'boards.greenhouse.io' };
    }
  }
  // Workday: …/job/{location}/{title}_{reqId}/apply[/applyManually|/autofillWithResume…]
  if (/\.myworkdayjobs\.com$/.test(host)) return { path: path.replace(/\/apply(\/.*)?$/i, '') };
  return { path };
}

/**
 * Canonical job-posting URL: https, lowercase host, no fragment, tracking params removed,
 * and the /apply form URL mapped back to the posting URL where the platform allows.
 * Returns the input unchanged when it cannot be parsed.
 */
export function canonicalPostingUrl(input: string): string {
  let u: URL;
  try {
    u = new URL(input);
  } catch {
    return input;
  }
  const host = u.hostname.toLowerCase();

  // LinkedIn: only the job id matters, wherever the page lives (view page or collections/search).
  if (/(^|\.)linkedin\.com$/.test(host)) {
    const id = u.pathname.match(/\/jobs\/view\/(?:[^/]*?-)?(\d{6,})/)?.[1] ?? u.searchParams.get('currentJobId');
    if (id) return `https://www.linkedin.com/jobs/view/${id}`;
  }

  const params = new URLSearchParams(u.search);
  const mapped = postingPath(host, u.pathname, params);
  for (const key of [...params.keys()]) if (isTracking(key)) params.delete(key);

  const out = new URL(`https://${mapped.host ?? host}${mapped.path}`);
  out.search = params.toString();
  out.pathname = out.pathname.replace(/\/+$/, '') || '/';
  return out.toString().replace(/\/$/, out.search ? '/' : '');
}
