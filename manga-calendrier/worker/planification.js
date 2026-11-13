// Déclencheurs horaires (Cron Triggers de Cloudflare) : lancent des workflows GitHub à l'heure exacte.
// Les tâches planifiées de GitHub partent parfois avec plusieurs heures de retard, pas celles-ci.
// Il faut le secret GITHUB_TOKEN du Worker : jeton GitHub limité à ce dépôt, permission « Actions : lecture et écriture » seulement.
export const REPO = 'SamTadaManga/manga-calendrier';
// expression cron (celle de wrangler.jsonc) -> quels workflows lancer
export const PLAN = {
  '5 22,23 * * *': { workflows: ['deploy.yml'], heureParis: 0 }, // reconstruction du site juste après minuit à Paris (l'un des deux créneaux tombe à 0 h selon l'heure d'été)
  '12 6 * * *': { workflows: ['social.yml'], inputs: { dry_run: 'false' } }, // publication du matin : sans cette entrée, le formulaire du workflow garde « essai à blanc » (par défaut) et rien n'est publié
};

export const heureParis = (date) => Number(new Intl.DateTimeFormat('en-GB', { timeZone: 'Europe/Paris', hour: '2-digit', hourCycle: 'h23' }).format(date));

/** Workflows à lancer pour ce créneau ([] si ce n'est pas le bon des deux créneaux horaires). */
export function aLancer(cron, date) {
  const p = PLAN[cron];
  if (!p) return [];
  if (p.heureParis !== undefined && heureParis(date) !== p.heureParis) return [];
  return p.workflows;
}
/** Saisies du formulaire du workflow à fournir au lancement (ex. dry_run: 'false'). */
export const saisies = (cron, workflow) => ((PLAN[cron] && PLAN[cron].workflows.includes(workflow) && PLAN[cron].inputs) || undefined);

/** Lance un workflow GitHub (workflow_dispatch) sur la branche main. Renvoie { ok, status }. */
export async function lancer(env, workflow, fetchFn = fetch, inputs) {
  if (!env.GITHUB_TOKEN) throw new Error('secret GITHUB_TOKEN absent');
  const r = await fetchFn(`https://api.github.com/repos/${REPO}/actions/workflows/${workflow}/dispatches`, {
    method: 'POST',
    headers: { Authorization: `Bearer ${env.GITHUB_TOKEN}`, Accept: 'application/vnd.github+json', 'X-GitHub-Api-Version': '2022-11-28', 'User-Agent': 'prochaintome-planification', 'Content-Type': 'application/json' },
    body: JSON.stringify(inputs ? { ref: 'main', inputs } : { ref: 'main' }),
  });
  if (r.status !== 204) throw new Error(`GitHub ${workflow} : ${r.status} ${(await r.text()).slice(0, 200)}`);
  return { ok: true, status: r.status };
}

/** Point d'entrée du déclencheur horaire. */
export async function declencher(event, env, fetchFn = fetch) {
  const date = new Date(event.scheduledTime || Date.now());
  const list = aLancer(event.cron, date);
  const out = [];
  for (const w of list) {
    try { out.push({ workflow: w, ...(await lancer(env, w, fetchFn, saisies(event.cron, w))) }); console.log(`planification : ${w} lancé`); }
    catch (e) { out.push({ workflow: w, ok: false, erreur: e.message }); console.error(`planification : ${e.message}`); }
  }
  if (out.some((x) => !x.ok)) throw new Error(out.filter((x) => !x.ok).map((x) => x.erreur).join(' ; '));
  return out;
}
