# Intégration SFCGAL dans JupyterGIS

Ce document décrit l'intégration de SFCGAL (via PySFCGAL) dans JupyterGIS pour fournir des opérations de géométrie computationnelle avancées.

## Vue d'ensemble

[SFCGAL](https://sfcgal.gitlab.io/SFCGAL/) est une bibliothèque C++ de géométrie computationnelle basée sur CGAL, offrant des opérations géométriques robustes en 2D et 3D. [PySFCGAL](https://gitlab.com/sfcgal/pysfcgal) est le binding Python officiel.

### Pourquoi SFCGAL ?

| Critère         | GDAL/OGR (existant)  | SFCGAL (nouveau)         |
| --------------- | -------------------- | ------------------------ |
| **Exécution**   | Client (WebAssembly) | Serveur (Python)         |
| **Précision**   | Floating-point       | Arithmétique exacte CGAL |
| **3D**          | Non                  | Oui                      |
| **Robustesse**  | Moyenne              | Excellente               |
| **Performance** | Limitée par WASM     | Native C++               |

### Opérations disponibles

| Opération                  | Fonction PySFCGAL          | Description                          |
| -------------------------- | -------------------------- | ------------------------------------ |
| **Triangulation Delaunay** | `triangulate_2dz()`        | Triangulation de points/polygones    |
| **Straight Skeleton**      | `straight_skeleton()`      | Squelette droit de polygones         |
| **Offset Polygon**         | `offset_polygon(distance)` | Buffer basé sur le straight skeleton |
| **Extrusion 3D**           | `extrude(dx, dy, dz)`      | Extrusion de géométries en 3D        |

---

## Architecture

```
┌─────────────────────────────────────────────────────────────┐
│                   JupyterGIS Client (TypeScript)            │
│  ┌──────────────────┐    ┌────────────────────────────────┐ │
│  │  Processing UI   │    │        OpenLayers Map          │ │
│  │  (React Forms)   │    │                                │ │
│  └────────┬─────────┘    └────────────────────────────────┘ │
│           │                                                  │
│  ┌────────▼─────────────────────────────────────────────┐   │
│  │              Processing Router                        │   │
│  │  ┌──────────────────┐    ┌─────────────────────────┐ │   │
│  │  │   GDAL Engine    │    │    SFCGAL Engine        │ │   │
│  │  │   (gdal3.js)     │    │  (HTTP POST to server)  │ │   │
│  │  │   [WebAssembly]  │    │                         │ │   │
│  │  └──────────────────┘    └───────────┬─────────────┘ │   │
│  └──────────────────────────────────────┼───────────────┘   │
└─────────────────────────────────────────┼───────────────────┘
                                          │
                    POST /jupytergis_core/sfcgal
                    {operation, geojson, params}
                                          │
┌─────────────────────────────────────────▼───────────────────┐
│                 JupyterLab Server (Python)                  │
│  ┌──────────────────────────────────────────────────────┐  │
│  │              SFCGALProcessingHandler                  │  │
│  │  ┌────────────────────────────────────────────────┐  │  │
│  │  │                   PySFCGAL                      │  │  │
│  │  │  ┌──────────────────────────────────────────┐  │  │  │
│  │  │  │              SFCGAL (C++)                 │  │  │  │
│  │  │  │  ┌────────────────────────────────────┐  │  │  │  │
│  │  │  │  │           CGAL Library             │  │  │  │  │
│  │  │  │  └────────────────────────────────────┘  │  │  │  │
│  │  │  └──────────────────────────────────────────┘  │  │  │
│  │  └────────────────────────────────────────────────┘  │  │
│  └──────────────────────────────────────────────────────┘  │
└─────────────────────────────────────────────────────────────┘
```

---

## Structure des fichiers

### Schémas JSON (UI Forms)

Les schémas définissent les formulaires générés automatiquement pour chaque opération.

```
packages/schema/src/schema/processing/
├── delaunayTriangulation.json
├── straightSkeleton.json
├── offsetPolygon.json
└── extrude.json
```

**Exemple** (`delaunayTriangulation.json`) :

```json
{
  "type": "object",
  "description": "DelaunayTriangulation",
  "title": "IDelaunayTriangulation",
  "required": ["inputLayer"],
  "additionalProperties": false,
  "properties": {
    "inputLayer": {
      "type": "string",
      "description": "The input layer for Delaunay triangulation."
    },
    "embedOutputLayer": {
      "type": "boolean",
      "title": "Embed output triangulated layer in file",
      "default": true
    }
  }
}
```

### Configurations Processing

Les configurations définissent le comportement de chaque opération.

```
packages/schema/src/processing/config/
├── delaunayTriangulation.json
├── straightSkeleton.json
├── offsetPolygon.json
└── extrude.json
```

**Exemple** (`delaunayTriangulation.json`) :

```json
{
  "name": "delaunayTriangulation",
  "label": "Delaunay Triangulation",
  "operationParams": [],
  "operations": {
    "function": "triangulate_2dz"
  },
  "type": "sfcgal"
}
```

### Code Python (Serveur)

```
python/jupytergis_core/jupytergis_core/
├── sfcgal_processing.py    # Logique de traitement SFCGAL
├── handler.py              # Endpoint HTTP (modifié)
└── tests/
    └── test_sfcgal_processing.py
```

### Code TypeScript (Client)

```
packages/base/src/processing/
├── sfcgalProcessing.ts     # Client API SFCGAL
├── processingCommands.ts   # Commandes (modifié)
└── index.ts
```

---

## Implémentation détaillée

### 1. Handler Python (`sfcgal_processing.py`)

```python
from pysfcgal.sfcgal import Geometry, GeometryCollection

def delaunay_triangulation(geojson: Dict) -> Dict:
    """Triangulation Delaunay avec PySFCGAL."""
    # Conversion GeoJSON → SFCGAL (méthode native)
    sfcgal_geom = Geometry.from_geojson(geojson)

    # Validation
    if not sfcgal_geom.is_valid():
        reason = sfcgal_geom.is_valid_detail()[0]
        raise ValueError(f"Invalid geometry: {reason}")

    # Opération SFCGAL
    result = sfcgal_geom.triangulate_2dz()

    # Conversion SFCGAL → GeoJSON (méthode native)
    return result.to_geojson_dict()
```

### 2. Endpoint HTTP (`handler.py`)

```python
class SFCGALProcessingHandler(APIHandler):
    @tornado.web.authenticated
    async def post(self) -> None:
        body = self.get_json_body()
        operation = body.get("operation")
        geojson = body.get("geojson")
        params = body.get("params", {})

        result = process_geometry(operation, geojson, params)
        self.finish(json.dumps(result))
```

### 3. Client TypeScript (`sfcgalProcessing.ts`)

```typescript
export async function executeSFCGALProcessing(
  operation: string,
  geojson: any,
  params: IDict = {},
): Promise<any> {
  const response = await requestAPI<any>('jupytergis_core/sfcgal', {
    method: 'POST',
    body: JSON.stringify({ operation, geojson, params }),
  });
  return response;
}
```

### 4. Commandes Processing (`processingCommands.ts`)

```typescript
if (processingElement.type === ProcessingLogicType.sfcgal) {
  commands.addCommand(processingElement.name, {
    label: trans.__(processingElement.label),
    isEnabled: () => selectedLayerIsOfType(['VectorLayer'], tracker),
    execute: async () => {
      await processSFCGALOperation(
        tracker,
        formSchemaRegistry,
        processingElement.description as ProcessingType,
        processingElement.operations.function,
        app,
      );
    },
  });
}
```

---

## Installation

### Prérequis

1. **SFCGAL** doit être installé sur le système :

   | Plateforme    | Commande                              |
   | ------------- | ------------------------------------- |
   | Ubuntu/Debian | `apt install libsfcgal-dev`           |
   | macOS         | `brew install sfcgal`                 |
   | Conda         | `conda install -c conda-forge sfcgal` |
   | FreeBSD       | `pkg install sfcgal`                  |

2. **PySFCGAL** :

   ```bash
   pip install pysfcgal
   ```

### Installation avec JupyterGIS

```bash
# Installation standard (sans SFCGAL)
pip install jupytergis

# Installation avec support SFCGAL
pip install jupytergis
pip install pysfcgal

# Ou depuis le dépôt de développement
pip install -e "python/jupytergis_core[sfcgal]"
```

---

## Utilisation

### Via l'interface graphique

1. Ouvrir un fichier `.jGIS` dans JupyterLab
2. Sélectionner une couche vectorielle
3. Menu **Processing** → Choisir une opération SFCGAL
4. Configurer les paramètres dans le formulaire
5. Cliquer **OK** pour exécuter

### Via l'API Python

```python
from jupytergis_core.sfcgal_processing import (
    delaunay_triangulation,
    straight_skeleton,
    offset_polygon,
    extrude,
)

# Charger un GeoJSON
geojson = {
    "type": "Polygon",
    "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
}

# Triangulation Delaunay
result = delaunay_triangulation(geojson)

# Straight Skeleton
skeleton = straight_skeleton(geojson)

# Offset (buffer)
buffered = offset_polygon(geojson, distance=2.0)

# Extrusion 3D
extruded = extrude(geojson, height=5.0)
```

---

## Tests

### Exécuter les tests

```bash
# Installer les dépendances de test
pip install pytest pysfcgal

# Lancer les tests SFCGAL
pytest --color=yes -v python/jupytergis_core/jupytergis_core/tests/test_sfcgal_processing.py
```

### Tests disponibles

- `TestSFCGALAvailability` : Vérification de la disponibilité
- `TestDelaunayTriangulation` : Triangulation de points et polygones
- `TestStraightSkeleton` : Squelette de formes diverses
- `TestOffsetPolygon` : Offset positif et négatif
- `TestExtrude` : Extrusion de polygones et lignes
- `TestErrorHandling` : Gestion des erreurs

---

## Compatibilité JupyterLite

⚠️ **Limitation** : Les opérations SFCGAL ne sont **pas disponibles** dans JupyterLite car :

- PySFCGAL nécessite la bibliothèque C++ native SFCGAL
- Pas de build WebAssembly disponible actuellement

**Solution** : L'interface détecte automatiquement la disponibilité de SFCGAL et affiche un message d'erreur approprié si non disponible.

---

## Ajouter une nouvelle opération SFCGAL

### 1. Créer le schéma JSON

```json
// packages/schema/src/schema/processing/myOperation.json
{
  "type": "object",
  "description": "MyOperation",
  "title": "IMyOperation",
  "required": ["inputLayer"],
  "properties": {
    "inputLayer": {
      "type": "string",
      "description": "Input layer"
    },
    "myParam": {
      "type": "number",
      "default": 1.0,
      "description": "My parameter"
    },
    "embedOutputLayer": {
      "type": "boolean",
      "default": true
    }
  }
}
```

### 2. Créer la configuration

```json
// packages/schema/src/processing/config/myOperation.json
{
  "name": "myOperation",
  "label": "My Operation",
  "operationParams": ["myParam"],
  "operations": {
    "function": "my_sfcgal_function"
  },
  "type": "sfcgal"
}
```

### 3. Ajouter la fonction Python

```python
# Dans sfcgal_processing.py

def my_operation(geojson: Dict, my_param: float) -> Dict:
    sfcgal_geom = Geometry.from_geojson(geojson)
    result = sfcgal_geom.my_sfcgal_function(my_param)
    return result.to_geojson_dict()

# Enregistrer l'opération
SFCGAL_OPERATIONS["my_sfcgal_function"] = my_operation
```

### 4. Mettre à jour le mapping des paramètres

```python
# Dans process_geometry()
elif operation == "my_sfcgal_function":
    param = params.get("myParam", 1.0)
    return func(geojson, param)
```

### 5. Reconstruire

```bash
jlpm run build
```

---

## Références

- [SFCGAL Documentation](https://sfcgal.gitlab.io/SFCGAL/)
- [PySFCGAL Repository](https://gitlab.com/sfcgal/pysfcgal)
- [CGAL Library](https://www.cgal.org/)
- [GeoJSON RFC 7946](https://datatracker.ietf.org/doc/html/rfc7946)
