● Voici les étapes pour lancer JupyterGIS en mode développement :

# 1. Se placer dans le répertoire jupytergis

cd /home/lbartoletti/prog/jupytergis

# 2. Installer les dépendances Python (si pas déjà fait)

pip install -e "python/jupytergis_core[sfcgal]" -e "python/jupytergis_lab"

# 3. Installer les dépendances npm et construire

jlpm install
jlpm run build

# 4. Installer l'extension en mode développement

jlpm run dev

# 5. Lancer JupyterLab

jupyter lab

Ou en mode watch (recompilation automatique lors des modifications) :

# Terminal 1 : Watch des packages TypeScript

jlpm run watch

# Terminal 2 : Lancer JupyterLab

jupyter lab --watch

Pour tester la vue 3D :

1. Ouvrir un fichier .jGIS ou en créer un nouveau
2. Ajouter une couche GeoJSON avec des géométries 3D (TIN, PolyhedralSurface, etc.)
3. Cliquer sur le bouton 3D (icône cube) dans la toolbar pour basculer en vue 3D

Exemple de GeoJSON 3D à tester :

{
"type": "Feature",
"geometry": {
"type": "Polygon",
"coordinates": [[[0, 0, 0], [10, 0, 0], [10, 10, 5], [0, 10, 5], [0, 0, 0]]]
}
}

Voulez-vous que je vérifie si le build fonctionne correctement d'abord ?
