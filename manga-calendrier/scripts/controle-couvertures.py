#!/usr/bin/env python3
"""Contrôle des couvertures par un modèle de classification d'images (deepghs/anime_rating, via dghs-imgutils) : safe / r15 / r18.

Usage : python3 scripts/controle-couvertures.py cibles.json data/couvertures-controle.json [--minutes=40] [--workers=6]
        python3 scripts/controle-couvertures.py --autotest
  cibles.json : [{ "cle": "series/<slug>" | "isbn/<isbn13>", "url": "https://img.prochaintome.fr/..." }]   (voir scripts/adulte-images.mjs liste)
  Écrit { "maj": date, "vus": { cle: [score_r18, score_r15] | null } } : null = couverture introuvable. Reprend là où il s'est arrêté.
La décision (seuil, séries retirées) est prise par scripts/adulte-images.mjs, pas ici : ce script ne fait que mesurer.
"""
import argparse, concurrent.futures as cf, datetime, io, json, os, sys, time, urllib.request

UA = "manga-calendrier/1.0 (controle des couvertures du site)"


def charger_modele():
    try:
        from imgutils.validate import anime_rating_score
    except Exception as e:  # modèle ou bibliothèque indisponible : on s'arrête sans rien écrire
        sys.exit(f"Bibliothèque dghs-imgutils indisponible : {e}")
    return anime_rating_score


def mesurer(fn, img):
    """Image PIL -> (score r18, score r15)."""
    s = fn(img)
    if not isinstance(s, dict) or "r18" not in s:
        raise RuntimeError(f"Sortie inattendue du modèle : {s!r}")
    return float(s["r18"]), float(s.get("r15", 0.0))


def telecharger(url):
    try:
        req = urllib.request.Request(url, headers={"User-Agent": UA})
        with urllib.request.urlopen(req, timeout=25) as r:
            return r.read()
    except Exception:
        return None


def autotest():
    from PIL import Image
    fn = charger_modele()
    img = Image.new("RGB", (300, 420), (200, 120, 90))
    r18, r15 = mesurer(fn, img)
    if not (0.0 <= r18 <= 1.0 and 0.0 <= r15 <= 1.0):
        sys.exit("Scores hors de l'intervalle 0-1.")
    print(f"Modèle opérationnel (image unie : r18={r18:.3f}, r15={r15:.3f}).")


def main():
    ap = argparse.ArgumentParser()
    ap.add_argument("cibles", nargs="?")
    ap.add_argument("etat", nargs="?")
    ap.add_argument("--minutes", type=float, default=40)
    ap.add_argument("--workers", type=int, default=6)
    ap.add_argument("--autotest", action="store_true")
    a = ap.parse_args()
    if a.autotest:
        return autotest()
    if not a.cibles or not a.etat:
        ap.error("cibles.json et le fichier d'état sont nécessaires")
    from PIL import Image
    fn = charger_modele()
    cibles = json.load(open(a.cibles, encoding="utf-8"))
    try:
        etat = json.load(open(a.etat, encoding="utf-8"))
    except Exception:
        etat = {}
    vus = etat.get("vus", {})
    fin = time.time() + a.minutes * 60
    n = flag = 0

    def sauver():
        etat["maj"] = datetime.date.today().isoformat()
        etat["vus"] = vus
        tmp = a.etat + ".tmp"
        json.dump(etat, open(tmp, "w", encoding="utf-8"), separators=(",", ":"))
        os.replace(tmp, a.etat)

    # Les téléchargements se font en parallèle ; le modèle est appelé ici, un à la fois.
    with cf.ThreadPoolExecutor(max_workers=a.workers) as ex:
        for i in range(0, len(cibles), 60):
            if time.time() > fin:
                print("Temps imparti atteint, arrêt propre.")
                break
            lot = cibles[i:i + 60]
            for c, data in zip(lot, ex.map(lambda c: telecharger(c["url"]), lot)):
                if data is None:
                    vus[c["cle"]] = None
                    continue
                try:
                    img = Image.open(io.BytesIO(data)).convert("RGB")
                    r18, r15 = mesurer(fn, img)
                except Exception as e:
                    print(f"  {c['cle']} : {e}")
                    continue
                vus[c["cle"]] = [round(r18, 3), round(r15, 3)]
                n += 1
                flag += r18 >= 0.85
            sauver()
            print(f"{min(i + 60, len(cibles))}/{len(cibles)} contrôlées, {flag} classées r18 (score ≥ 0,85).")
    sauver()
    print(f"Terminé : {n} couvertures mesurées, {flag} classées r18.")


if __name__ == "__main__":
    main()
