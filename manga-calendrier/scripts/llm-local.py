"""Écrit les résumés avec un petit modèle de langage local (llama.cpp, sur le processeur du serveur GitHub).
Usage : MODEL_PATH=modele.gguf python scripts/llm-local.py taches.json resultats.json [minutes]
Chaque résultat est enregistré dès qu'il est prêt : si le temps imparti est atteint, ce qui est fait est conservé."""
import json, os, re, sys, time

from llama_cpp import Llama

taches = json.load(open(sys.argv[1], encoding="utf8"))
sortie = sys.argv[2]
budget = float(sys.argv[3]) * 60 if len(sys.argv) > 3 else 6000
debut = time.time()
llm = Llama(model_path=os.environ["MODEL_PATH"], n_ctx=2048, n_threads=os.cpu_count() or 4, verbose=False)
res = []
for i, t in enumerate(taches):
    if time.time() - debut > budget:
        print(f"Temps imparti atteint après {i} résumés.")
        break
    try:
        r = llm.create_chat_completion(messages=t["messages"], max_tokens=300, temperature=0.3, top_p=0.9, repeat_penalty=1.1)
        texte = r["choices"][0]["message"]["content"] or ""
    except Exception as e:  # une série qui échoue n'arrête pas les autres
        print(f"{t['k']} : {e}")
        continue
    texte = re.sub(r"<think>.*?</think>", "", texte, flags=re.S).strip()
    res.append({"k": t["k"], "h": t["h"], "x": t["x"], "sortie": texte})
    json.dump(res, open(sortie, "w", encoding="utf8"), ensure_ascii=False)
    print(f"{i + 1}/{len(taches)} {t['k']} ({int(time.time() - debut)} s)")
json.dump(res, open(sortie, "w", encoding="utf8"), ensure_ascii=False)
