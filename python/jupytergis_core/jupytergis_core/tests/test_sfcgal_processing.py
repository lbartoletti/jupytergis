"""
Tests for SFCGAL processing module.

These tests require PySFCGAL to be installed.
Run with: pytest --color=yes -v python/jupytergis_core/jupytergis_core/tests/
"""

import pytest

# Try to import PySFCGAL - skip tests if not available
try:
    from pysfcgal.sfcgal import Geometry
    SFCGAL_AVAILABLE = True
except ImportError:
    SFCGAL_AVAILABLE = False

from jupytergis_core.sfcgal_processing import (
    is_sfcgal_available,
    delaunay_triangulation,
    straight_skeleton,
    offset_polygon,
    extrude,
    process_geometry,
    SFCGAL_OPERATIONS,
)


# Skip all tests if SFCGAL is not available
pytestmark = pytest.mark.skipif(
    not SFCGAL_AVAILABLE,
    reason="PySFCGAL is not installed"
)


class TestSFCGALAvailability:
    """Tests for SFCGAL availability check."""

    def test_is_sfcgal_available(self):
        """Test that SFCGAL availability is correctly detected."""
        assert is_sfcgal_available() == SFCGAL_AVAILABLE

    def test_operations_registered(self):
        """Test that all expected operations are registered."""
        expected_operations = [
            "triangulate_2dz",
            "straight_skeleton",
            "offset_polygon",
            "extrude",
        ]
        for op in expected_operations:
            assert op in SFCGAL_OPERATIONS


class TestDelaunayTriangulation:
    """Tests for Delaunay triangulation."""

    def test_triangulate_points(self):
        """Test triangulation of a point cloud."""
        geojson = {
            "type": "FeatureCollection",
            "features": [
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0, 0]}, "properties": {}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [1, 0]}, "properties": {}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0.5, 1]}, "properties": {}},
                {"type": "Feature", "geometry": {"type": "Point", "coordinates": [0.5, 0.5]}, "properties": {}},
            ]
        }

        result = delaunay_triangulation(geojson)

        assert result is not None
        assert "type" in result

    def test_triangulate_polygon_vertices(self):
        """Test triangulation using polygon vertices."""
        geojson = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]
            },
            "properties": {}
        }

        result = delaunay_triangulation(geojson)

        assert result is not None

    def test_triangulate_direct_geometry(self):
        """Test triangulation with direct geometry (not Feature)."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [2, 0], [1, 2], [0, 0]]]
        }

        result = delaunay_triangulation(geojson)

        assert result is not None


class TestStraightSkeleton:
    """Tests for straight skeleton computation."""

    def test_skeleton_square(self):
        """Test straight skeleton of a square polygon."""
        geojson = {
            "type": "Feature",
            "geometry": {
                "type": "Polygon",
                "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
            },
            "properties": {}
        }

        result = straight_skeleton(geojson)

        assert result is not None

    def test_skeleton_l_shape(self):
        """Test straight skeleton of an L-shaped polygon."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [6, 0], [6, 3], [3, 3], [3, 6], [0, 6], [0, 0]]]
        }

        result = straight_skeleton(geojson)

        assert result is not None


class TestOffsetPolygon:
    """Tests for offset polygon (buffer using straight skeleton)."""

    def test_offset_outward(self):
        """Test outward offset (positive distance)."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        }

        result = offset_polygon(geojson, 1.0)

        assert result is not None

    def test_offset_inward(self):
        """Test inward offset (negative distance)."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        }

        result = offset_polygon(geojson, -1.0)

        assert result is not None


class TestExtrude:
    """Tests for 3D extrusion."""

    def test_extrude_polygon(self):
        """Test extruding a polygon to 3D."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        }

        result = extrude(geojson, 5.0)

        assert result is not None

    def test_extrude_linestring(self):
        """Test extruding a linestring to a surface."""
        geojson = {
            "type": "LineString",
            "coordinates": [[0, 0], [10, 0], [10, 10]]
        }

        result = extrude(geojson, 3.0)

        assert result is not None


class TestProcessGeometry:
    """Tests for the generic process_geometry function."""

    def test_process_triangulation(self):
        """Test processing with triangulation operation."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [4, 0], [4, 4], [0, 4], [0, 0]]]
        }

        result = process_geometry("triangulate_2dz", geojson)

        assert result is not None

    def test_process_offset_with_params(self):
        """Test processing offset with parameters."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        }

        result = process_geometry(
            "offset_polygon",
            geojson,
            {"offsetDistance": 2.0}
        )

        assert result is not None

    def test_process_extrude_with_params(self):
        """Test processing extrude with parameters."""
        geojson = {
            "type": "Polygon",
            "coordinates": [[[0, 0], [10, 0], [10, 10], [0, 10], [0, 0]]]
        }

        result = process_geometry(
            "extrude",
            geojson,
            {"extrudeHeight": 15.0}
        )

        assert result is not None

    def test_process_unknown_operation(self):
        """Test that unknown operation raises error."""
        geojson = {"type": "Point", "coordinates": [0, 0]}

        with pytest.raises(ValueError, match="Unknown operation"):
            process_geometry("unknown_operation", geojson)


class TestErrorHandling:
    """Tests for error handling."""

    def test_empty_feature_collection(self):
        """Test error handling for empty FeatureCollection."""
        geojson = {"type": "FeatureCollection", "features": []}

        with pytest.raises(ValueError, match="Empty FeatureCollection"):
            delaunay_triangulation(geojson)

    def test_feature_without_geometry(self):
        """Test error handling for Feature without geometry."""
        geojson = {"type": "Feature", "properties": {}}

        with pytest.raises(ValueError, match="no geometry"):
            delaunay_triangulation(geojson)
