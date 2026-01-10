import * as THREE from 'three';

export interface GeoJSONToThreeOptions {
  color?: number | string;
  extrude?: boolean;
  extrudeHeight?: number;
  wireframe?: boolean;
  wireframeColor?: number | string;
}

export interface ConversionResult {
  object: THREE.Object3D;
  boundingBox: THREE.Box3;
}

export function geojsonToThree(
  geojson: any,
  options: GeoJSONToThreeOptions = {},
): ConversionResult {
  const {
    color = 0x00ff00,
    extrude = false,
    extrudeHeight = 10,
    wireframe = true,
    wireframeColor = 0x000000,
  } = options;

  // Auto-detect if the geometry has 3D coordinates (Z-values)
  let has3DCoordinates = false;
  const features =
    geojson.type === 'FeatureCollection'
      ? geojson.features
      : [geojson.type === 'Feature' ? geojson : { type: 'Feature', geometry: geojson }];

  // Check if any geometry has Z coordinates
  for (const feature of features) {
    const { geometry } = feature;
    if (!geometry) continue;

    if (geometry.type === 'Polygon' || geometry.type === 'MultiPolygon') {
      const coords = geometry.type === 'Polygon' ? [geometry.coordinates] : geometry.coordinates;
      for (const polygon of coords) {
        const ring = polygon[0]; // exterior ring
        for (const point of ring) {
          if (point.length > 2) { // has Z coordinate
            has3DCoordinates = true;
            break;
          }
        }
        if (has3DCoordinates) break;
      }
      if (has3DCoordinates) break;
    }
  }

  const object = new THREE.Object3D();
  const boundingBox = new THREE.Box3();

  for (const feature of features) {
    const { geometry } = feature;
    if (!geometry) {
      continue;
    }

    const material = new THREE.MeshPhongMaterial({
      color: new THREE.Color(color),
      side: THREE.DoubleSide,
      transparent: true,
      opacity: 0.8,
    });

    const wireframeMaterial = new THREE.LineBasicMaterial({
      color: new THREE.Color(wireframeColor),
      linewidth: 1,
    });

    switch (geometry.type) {
      case 'Polygon':
        {
          // If the polygon has Z-coordinates, create 3D geometry directly from coordinates
          if (has3DCoordinates && !extrude) {
            // Create a 3D shape using the actual coordinates
            const vertices = [];
            const indices = [];

            // Extract the outer ring
            const outerRing = geometry.coordinates[0];
            // Skip the last point if it's the same as the first (closed polygon)
            const ringPoints = outerRing.slice(0, outerRing.length - 1);

            // Add vertices
            for (const point of ringPoints) {
              if (point.length >= 3) {
                vertices.push(point[0], point[1], point[2]); // x, y, z
              } else {
                vertices.push(point[0], point[1], 0); // default z=0 if not provided
              }
            }

            // For a simple polygon, create triangles using a fan approach
            if (vertices.length >= 9) { // at least 3 points (9 coordinates)
              for (let i = 1; i < (vertices.length / 3) - 1; i++) {
                indices.push(0, i, i + 1);
              }
            }

            const geom = new THREE.BufferGeometry();
            const positionAttribute = new THREE.Float32BufferAttribute(vertices, 3);
            geom.setAttribute('position', positionAttribute);
            if (indices.length > 0) {
              geom.setIndex(indices);
            }
            geom.computeVertexNormals();

            const mesh = new THREE.Mesh(geom, material);
            object.add(mesh);
            boundingBox.expandByObject(mesh);

            if (wireframe) {
              const wireframeGeom = new THREE.EdgesGeometry(mesh.geometry);
              const wireframeMesh = new THREE.LineSegments(
                wireframeGeom,
                wireframeMaterial,
              );
              object.add(wireframeMesh);
            }
          } else {
            // Original behavior for 2D polygons with optional extrusion
            const shape = new THREE.Shape();
            const points = geometry.coordinates[0];
            shape.moveTo(points[0][0], points[0][1]);
            for (let i = 1; i < points.length; i++) {
              shape.lineTo(points[i][0], points[i][1]);
            }

            if (extrude) {
              const extrudeSettings = {
                steps: 1,
                depth: extrudeHeight,
                bevelEnabled: false,
              };
              const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
              const mesh = new THREE.Mesh(geom, material);
              object.add(mesh);
              boundingBox.expandByObject(mesh);
              if (wireframe) {
                const wireframeGeom = new THREE.EdgesGeometry(mesh.geometry);
                const wireframeMesh = new THREE.LineSegments(
                  wireframeGeom,
                  wireframeMaterial,
                );
                object.add(wireframeMesh);
              }
            } else {
              const geom = new THREE.ShapeGeometry(shape);
              const mesh = new THREE.Mesh(geom, material);
              object.add(mesh);
              boundingBox.expandByObject(mesh);
            }
          }
        }
        break;

      case 'MultiPolygon':
        {
          for (const poly of geometry.coordinates) {
            // If the polygon has Z-coordinates, create 3D geometry directly from coordinates
            if (has3DCoordinates && !extrude) {
              // Create a 3D shape using the actual coordinates
              const vertices = [];
              const indices = [];

              // Extract the outer ring
              const outerRing = poly[0];
              // Skip the last point if it's the same as the first (closed polygon)
              const ringPoints = outerRing.slice(0, outerRing.length - 1);

              // Add vertices
              for (const point of ringPoints) {
                if (point.length >= 3) {
                  vertices.push(point[0], point[1], point[2]); // x, y, z
                } else {
                  vertices.push(point[0], point[1], 0); // default z=0 if not provided
                }
              }

              // For a simple polygon, create triangles using a fan approach
              if (vertices.length >= 9) { // at least 3 points (9 coordinates)
                for (let i = 1; i < (vertices.length / 3) - 1; i++) {
                  indices.push(0, i, i + 1);
                }
              }

              const geom = new THREE.BufferGeometry();
              const positionAttribute = new THREE.Float32BufferAttribute(vertices, 3);
              geom.setAttribute('position', positionAttribute);
              if (indices.length > 0) {
                geom.setIndex(indices);
              }
              geom.computeVertexNormals();

              const mesh = new THREE.Mesh(geom, material);
              object.add(mesh);
              boundingBox.expandByObject(mesh);

              if (wireframe) {
                const wireframeGeom = new THREE.EdgesGeometry(mesh.geometry);
                const wireframeMesh = new THREE.LineSegments(
                  wireframeGeom,
                  wireframeMaterial,
                );
                object.add(wireframeMesh);
              }
            } else {
              // Original behavior for 2D polygons with optional extrusion
              const shape = new THREE.Shape();
              const points = poly[0];
              shape.moveTo(points[0][0], points[0][1]);
              for (let i = 1; i < points.length; i++) {
                shape.lineTo(points[i][0], points[i][1]);
              }

              if (extrude) {
                const extrudeSettings = {
                  steps: 1,
                  depth: extrudeHeight,
                  bevelEnabled: false,
                };
                const geom = new THREE.ExtrudeGeometry(shape, extrudeSettings);
                const mesh = new THREE.Mesh(geom, material);
                object.add(mesh);
                boundingBox.expandByObject(mesh);
                if (wireframe) {
                  const wireframeGeom = new THREE.EdgesGeometry(mesh.geometry);
                  const wireframeMesh = new THREE.LineSegments(
                    wireframeGeom,
                    wireframeMaterial,
                  );
                  object.add(wireframeMesh);
                }
              } else {
                const geom = new THREE.ShapeGeometry(shape);
                const mesh = new THREE.Mesh(geom, material);
                object.add(mesh);
                boundingBox.expandByObject(mesh);
              }
            }
          }
        }
        break;

      case 'Point':
        {
          const geom = new THREE.SphereGeometry(1, 16, 16);
          const mesh = new THREE.Mesh(geom, material);
          mesh.position.set(
            geometry.coordinates[0],
            geometry.coordinates[1],
            geometry.coordinates[2] || 0,
          );
          object.add(mesh);
          boundingBox.expandByObject(mesh);
        }
        break;

      case 'MultiPoint':
        {
          for (const point of geometry.coordinates) {
            const geom = new THREE.SphereGeometry(1, 16, 16);
            const mesh = new THREE.Mesh(geom, material);
            mesh.position.set(point[0], point[1], point[2] || 0);
            object.add(mesh);
            boundingBox.expandByObject(mesh);
          }
        }
        break;

      case 'LineString':
        {
          const points = geometry.coordinates.map(
            (p: any) => new THREE.Vector3(p[0], p[1], p[2] || 0),
          );
          const geom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geom, wireframeMaterial);
          object.add(line);
          boundingBox.expandByObject(line);
        }
        break;

      case 'MultiLineString':
        {
          for (const line of geometry.coordinates) {
            const points = line.map(
              (p: any) => new THREE.Vector3(p[0], p[1], p[2] || 0),
            );
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            const lineMesh = new THREE.Line(geom, wireframeMaterial);
            object.add(lineMesh);
            boundingBox.expandByObject(lineMesh);
          }
        }
        break;

      case 'TIN':
        {
          const geom = new THREE.BufferGeometry();
          const vertices = geometry.coordinates.flat(2);
          geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
          geom.computeVertexNormals();
          const mesh = new THREE.Mesh(geom, material);
          object.add(mesh);
          boundingBox.expandByObject(mesh);
          if (wireframe) {
            const wireframeGeom = new THREE.EdgesGeometry(mesh.geometry);
            const wireframeMesh = new THREE.LineSegments(
              wireframeGeom,
              wireframeMaterial,
            );
            object.add(wireframeMesh);
          }
        }
        break;

      case 'PolyhedralSurface':
        {
          const geom = new THREE.BufferGeometry();
          const vertices = geometry.coordinates.flat(2);
          geom.setAttribute('position', new THREE.Float32BufferAttribute(vertices, 3));
          geom.computeVertexNormals();
          const mesh = new THREE.Mesh(geom, material);
          object.add(mesh);
          boundingBox.expandByObject(mesh);
          if (wireframe) {
            const wireframeGeom = new THREE.EdgesGeometry(mesh.geometry);
            const wireframeMesh = new THREE.LineSegments(
              wireframeGeom,
              wireframeMaterial,
            );
            object.add(wireframeMesh);
          }
        }
        break;

      default:
        break;
    }
  }

  return { object, boundingBox };
}

export function computeCameraPosition(
  boundingBox: THREE.Box3,
  fov: number = 50,
  aspect: number = 1,
): THREE.Vector3 {
  const size = boundingBox.getSize(new THREE.Vector3());
  const center = boundingBox.getCenter(new THREE.Vector3());
  const maxSize = Math.max(size.x, size.y, size.z);
  const fitHeightDistance =
    maxSize / (2 * Math.atan((Math.PI * fov) / 360));
  const fitWidthDistance = fitHeightDistance / aspect;
  const distance = Math.max(fitHeightDistance, fitWidthDistance);

  const direction = new THREE.Vector3(1, -1, 1).normalize();

  return center.add(direction.multiplyScalar(distance));
}