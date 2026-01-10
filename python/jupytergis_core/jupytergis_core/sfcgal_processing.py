"""
SFCGAL-based geometry processing for JupyterGIS.

This module provides server-side geometry processing using PySFCGAL,
enabling advanced operations like Delaunay triangulation, straight skeleton,
offset polygon, and 3D extrusion.
"""

import json
import logging
from typing import Any, Dict, List, Optional, Union

logger = logging.getLogger(__name__)

# Try to import PySFCGAL
try:
    from pysfcgal.sfcgal import Geometry, GeometryCollection
    SFCGAL_AVAILABLE = True
except ImportError:
    SFCGAL_AVAILABLE = False
    logger.warning(
        "PySFCGAL is not installed. SFCGAL processing operations will not be available. "
        "Install with: pip install pysfcgal"
    )


def is_sfcgal_available() -> bool:
    """Check if SFCGAL is available."""
    return SFCGAL_AVAILABLE


def _geojson_to_sfcgal(geojson: Dict) -> "Geometry":
    """
    Convert GeoJSON to SFCGAL Geometry.

    Handles Feature, FeatureCollection, and direct Geometry objects.
    """
    geojson_type = geojson.get("type")

    if geojson_type == "FeatureCollection":
        features = geojson.get("features", [])
        if not features:
            raise ValueError("Empty FeatureCollection")

        geometries = []
        for feature in features:
            geom_data = feature.get("geometry")
            if geom_data:
                geometries.append(Geometry.from_geojson(geom_data))

        if len(geometries) == 1:
            return geometries[0]
        return GeometryCollection(geometries)

    elif geojson_type == "Feature":
        geom_data = geojson.get("geometry")
        if not geom_data:
            raise ValueError("Feature has no geometry")
        return Geometry.from_geojson(geom_data)

    else:
        # Direct geometry object
        return Geometry.from_geojson(geojson)


def _sfcgal_to_geojson(
    geom: "Geometry",
    original_geojson: Optional[Dict] = None,
    preserve_properties: bool = True
) -> Dict:
    """
    Convert SFCGAL Geometry back to GeoJSON.

    If original_geojson is provided and was a FeatureCollection,
    returns a FeatureCollection with the processed geometry.
    """
    result_geom = geom.to_geojson_dict()

    if original_geojson is None:
        return result_geom

    original_type = original_geojson.get("type")

    if original_type == "FeatureCollection":
        # Create a new FeatureCollection with the result
        return {
            "type": "FeatureCollection",
            "features": [
                {
                    "type": "Feature",
                    "geometry": result_geom,
                    "properties": {"processed": True}
                }
            ]
        }
    elif original_type == "Feature":
        properties = original_geojson.get("properties", {}) if preserve_properties else {}
        properties["processed"] = True
        return {
            "type": "Feature",
            "geometry": result_geom,
            "properties": properties
        }
    else:
        return result_geom


def delaunay_triangulation(geojson: Dict) -> Dict:
    """
    Perform Delaunay triangulation on input GeoJSON.

    Parameters
    ----------
    geojson : Dict
        Input GeoJSON (FeatureCollection, Feature, or Geometry)

    Returns
    -------
    Dict
        GeoJSON with triangulated result
    """
    if not SFCGAL_AVAILABLE:
        raise RuntimeError("PySFCGAL is not installed")

    sfcgal_geom = _geojson_to_sfcgal(geojson)

    if not sfcgal_geom.is_valid():
        reason = sfcgal_geom.is_valid_detail()[0]
        raise ValueError(f"Invalid input geometry: {reason}")

    result = sfcgal_geom.triangulate_2dz()

    if result is None:
        raise ValueError("Triangulation failed")

    return _sfcgal_to_geojson(result, geojson)


def straight_skeleton(geojson: Dict) -> Dict:
    """
    Compute the straight skeleton of polygon(s).

    Parameters
    ----------
    geojson : Dict
        Input GeoJSON with polygon geometry

    Returns
    -------
    Dict
        GeoJSON with straight skeleton result
    """
    if not SFCGAL_AVAILABLE:
        raise RuntimeError("PySFCGAL is not installed")

    sfcgal_geom = _geojson_to_sfcgal(geojson)

    if not sfcgal_geom.is_valid():
        reason = sfcgal_geom.is_valid_detail()[0]
        raise ValueError(f"Invalid input geometry: {reason}")

    result = sfcgal_geom.straight_skeleton()

    if result is None:
        raise ValueError("Straight skeleton computation failed")

    return _sfcgal_to_geojson(result, geojson)


def offset_polygon(geojson: Dict, distance: float) -> Dict:
    """
    Compute offset polygon (buffer using straight skeleton).

    Parameters
    ----------
    geojson : Dict
        Input GeoJSON with polygon geometry
    distance : float
        Offset distance (positive for outward, negative for inward)

    Returns
    -------
    Dict
        GeoJSON with offset polygon result
    """
    if not SFCGAL_AVAILABLE:
        raise RuntimeError("PySFCGAL is not installed")

    sfcgal_geom = _geojson_to_sfcgal(geojson)

    if not sfcgal_geom.is_valid():
        reason = sfcgal_geom.is_valid_detail()[0]
        raise ValueError(f"Invalid input geometry: {reason}")

    result = sfcgal_geom.offset_polygon(distance)

    if result is None:
        raise ValueError("Offset polygon computation failed")

    return _sfcgal_to_geojson(result, geojson)


def extrude(geojson: Dict, height: float) -> Dict:
    """
    Extrude geometry in 3D (Z direction).

    Parameters
    ----------
    geojson : Dict
        Input GeoJSON geometry
    height : float
        Extrusion height in Z direction

    Returns
    -------
    Dict
        GeoJSON with extruded 3D geometry
    """
    if not SFCGAL_AVAILABLE:
        raise RuntimeError("PySFCGAL is not installed")

    sfcgal_geom = _geojson_to_sfcgal(geojson)

    if not sfcgal_geom.is_valid():
        reason = sfcgal_geom.is_valid_detail()[0]
        raise ValueError(f"Invalid input geometry: {reason}")

    # Extrude in Z direction
    result = sfcgal_geom.extrude(0, 0, height)

    if result is None:
        raise ValueError("Extrusion failed")

    return _sfcgal_to_geojson(result, geojson)


# Mapping of operation names to functions
SFCGAL_OPERATIONS = {
    "triangulate_2dz": delaunay_triangulation,
    "straight_skeleton": straight_skeleton,
    "offset_polygon": offset_polygon,
    "extrude": extrude,
}


def process_geometry(
    operation: str,
    geojson: Dict,
    params: Optional[Dict[str, Any]] = None
) -> Dict:
    """
    Process geometry using SFCGAL operation.

    Parameters
    ----------
    operation : str
        Name of the SFCGAL operation
    geojson : Dict
        Input GeoJSON data
    params : Dict, optional
        Additional parameters for the operation

    Returns
    -------
    Dict
        Processed GeoJSON result
    """
    if not SFCGAL_AVAILABLE:
        raise RuntimeError("PySFCGAL is not installed")

    if operation not in SFCGAL_OPERATIONS:
        raise ValueError(f"Unknown operation: {operation}. Available: {list(SFCGAL_OPERATIONS.keys())}")

    func = SFCGAL_OPERATIONS[operation]
    params = params or {}

    # Map operation parameters
    if operation == "offset_polygon":
        distance = params.get("offsetDistance", 1.0)
        return func(geojson, distance)
    elif operation == "extrude":
        height = params.get("extrudeHeight", 10.0)
        return func(geojson, height)
    else:
        return func(geojson)
