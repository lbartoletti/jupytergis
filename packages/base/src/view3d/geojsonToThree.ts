import * as THREE from 'three';
import proj4 from 'proj4';
import proj4list from 'proj4-list';

// Function to get the projection code from GeoJSON CRS
function getProjectionCode(geojson: any): string | null {
  if (geojson.crs && geojson.crs.properties && geojson.crs.properties.name) {
    const crsName = geojson.crs.properties.name;
    // Convert urn:ogc:def:crs:EPSG::3946 to EPSG:3946
    if (crsName.startsWith('urn:ogc:def:crs:')) {
      return crsName.replace('urn:ogc:def:crs:', '').replace('::', ':');
    }
    return crsName;
  }
  return null;
}

// Function to transform coordinates from source CRS to target CRS
function transformCoordinates(coordinates: number[], sourceCRS: string, targetCRS: string = 'EPSG:4326'): number[] {
  // Check if the source CRS is available in proj4list
  if (!proj4list[sourceCRS]) {
    console.warn(`Source CRS '${sourceCRS}' not found in proj4list, returning original coordinates`);
    return coordinates;
  }

  try {
    // Define the projection if not already defined
    if (!(proj4.defs as any)[sourceCRS]) {
      // proj4list returns [code, definition], we need the definition at index [1]
      const projDef = proj4list[sourceCRS];
      const projString = Array.isArray(projDef) ? projDef[1] : projDef;
      (proj4.defs as any)(sourceCRS, projString);
    }
    if (!(proj4.defs as any)[targetCRS]) {
      // Define WGS84 as default target if not already defined
      (proj4.defs as any)(targetCRS, '+proj=longlat +datum=WGS84 +no_defs');
    }

    // Transform the coordinates
    return proj4(sourceCRS, targetCRS, coordinates);
  } catch (error) {
    console.warn(`Failed to transform coordinates from '${sourceCRS}' to '${targetCRS}':`, error);
    return coordinates; // Return original coordinates if transformation fails
  }
}

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

  // Get the source CRS from the GeoJSON
  const sourceCRS = getProjectionCode(geojson);
  const needsTransformation = sourceCRS !== null && sourceCRS !== 'EPSG:4326';

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

    // Helper to check if a point has Z
    const hasZ = (point: number[]) => point.length > 2;

    switch (geometry.type) {
      case 'Point':
        if (hasZ(geometry.coordinates)) has3DCoordinates = true;
        break;
      case 'MultiPoint':
      case 'LineString':
        if (geometry.coordinates.some(hasZ)) has3DCoordinates = true;
        break;
      case 'MultiLineString':
        for (const line of geometry.coordinates) {
          if (line.some(hasZ)) {
            has3DCoordinates = true;
            break;
          }
        }
        break;
      case 'Polygon':
        for (const ring of geometry.coordinates) {
          if (ring.some(hasZ)) {
            has3DCoordinates = true;
            break;
          }
        }
        break;
      case 'MultiPolygon':
        for (const polygon of geometry.coordinates) {
          for (const ring of polygon) {
            if (ring.some(hasZ)) {
              has3DCoordinates = true;
              break;
            }
          }
          if (has3DCoordinates) break;
        }
        break;
      case 'TIN':
      case 'PolyhedralSurface':
        // These are inherently 3D
        has3DCoordinates = true;
        break;
    }
    if (has3DCoordinates) break;
  }

  // Transform coordinates if needed and collect all coordinates for centroid calculation
  let transformedFeatures = features;
  let allCoordinates: number[][] = [];

  // Don't transform to WGS84 if we have 3D coordinates, because:
  // - WGS84 uses degrees for X/Y but Z remains in meters
  // - This creates a huge ratio mismatch (e.g., X=6.6°, Y=45.8°, Z=1176m)
  // - Instead, keep original projected coordinates and center around the centroid
  const shouldTransform = needsTransformation && sourceCRS && !has3DCoordinates;

  if (shouldTransform) {
    // Transform all features and collect coordinates
    transformedFeatures = features.map((feature: any) => {
      const transformedFeature = { ...feature };
      const geometry = transformedFeature.geometry;
      if (!geometry) return transformedFeature;

      // Transform the geometry coordinates
      const transformedGeometry = transformGeometry(geometry, sourceCRS);
      transformedFeature.geometry = transformedGeometry;

      // Collect coordinates from transformed geometry
      collectCoordinatesFromGeometry(transformedGeometry, allCoordinates);

      return transformedFeature;
    });
  } else {
    // No transformation needed, just collect original coordinates
    for (const feature of features) {
      const { geometry } = feature;
      if (!geometry) continue;
      collectCoordinatesFromGeometry(geometry, allCoordinates);
    }
  }

  // Calculate centroid of all coordinates
  let centroidX = 0;
  let centroidY = 0;
  let centroidZ = 0;
  if (allCoordinates.length > 0) {
    for (const coord of allCoordinates) {
      centroidX += coord[0];
      centroidY += coord[1];
      centroidZ += coord[2] || 0;
    }
    centroidX /= allCoordinates.length;
    centroidY /= allCoordinates.length;
    centroidZ /= allCoordinates.length;
  }

  const object = new THREE.Object3D();
  const boundingBox = new THREE.Box3();

  // Debug logging
  console.log('[geojsonToThree] has3DCoordinates:', has3DCoordinates);
  console.log('[geojsonToThree] shouldTransform:', shouldTransform);
  console.log('[geojsonToThree] sourceCRS:', sourceCRS);
  console.log('[geojsonToThree] centroid:', { centroidX, centroidY, centroidZ });
  console.log('[geojsonToThree] allCoordinates count:', allCoordinates.length);
  console.log('[geojsonToThree] features count:', transformedFeatures.length);

  for (const feature of transformedFeatures) {
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

            // Add vertices (subtract centroid to center around origin)
            for (const point of ringPoints) {
              if (point.length >= 3) {
                vertices.push(point[0] - centroidX, point[1] - centroidY, point[2] - centroidZ); // x, y, z
              } else {
                vertices.push(point[0] - centroidX, point[1] - centroidY, 0 - centroidZ); // default z=0 if not provided
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
            // Subtract centroid to center around origin
            shape.moveTo(points[0][0] - centroidX, points[0][1] - centroidY);
            for (let i = 1; i < points.length; i++) {
              shape.lineTo(points[i][0] - centroidX, points[i][1] - centroidY);
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

              // Add vertices (subtract centroid to center around origin)
              for (const point of ringPoints) {
                if (point.length >= 3) {
                  vertices.push(point[0] - centroidX, point[1] - centroidY, point[2] - centroidZ); // x, y, z
                } else {
                  vertices.push(point[0] - centroidX, point[1] - centroidY, 0 - centroidZ); // default z=0 if not provided
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
              // Subtract centroid to center around origin
              shape.moveTo(points[0][0] - centroidX, points[0][1] - centroidY);
              for (let i = 1; i < points.length; i++) {
                shape.lineTo(points[i][0] - centroidX, points[i][1] - centroidY);
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
          // Subtract centroid to center around origin
          mesh.position.set(
            geometry.coordinates[0] - centroidX,
            geometry.coordinates[1] - centroidY,
            (geometry.coordinates[2] || 0) - centroidZ,
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
            // Subtract centroid to center around origin
            mesh.position.set(point[0] - centroidX, point[1] - centroidY, (point[2] || 0) - centroidZ);
            object.add(mesh);
            boundingBox.expandByObject(mesh);
          }
        }
        break;

      case 'LineString':
        {
          // Subtract centroid to center around origin
          const points = geometry.coordinates.map(
            (p: any) => new THREE.Vector3(p[0] - centroidX, p[1] - centroidY, (p[2] || 0) - centroidZ),
          );
          const geom = new THREE.BufferGeometry().setFromPoints(points);
          const line = new THREE.Line(geom, wireframeMaterial);
          object.add(line);
          boundingBox.expandByObject(line);
        }
        break;

      case 'MultiLineString':
        {
          console.log('[geojsonToThree] Processing MultiLineString with', geometry.coordinates.length, 'lines');
          for (const line of geometry.coordinates) {
            // Subtract centroid to center around origin
            const points = line.map(
              (p: any) => new THREE.Vector3(p[0] - centroidX, p[1] - centroidY, (p[2] || 0) - centroidZ),
            );
            console.log('[geojsonToThree] Line points sample:', points.slice(0, 2));
            const geom = new THREE.BufferGeometry().setFromPoints(points);
            const lineMesh = new THREE.Line(geom, wireframeMaterial);
            object.add(lineMesh);
            boundingBox.expandByObject(lineMesh);
          }
        }
        break;

      case 'TIN':
        {
          // Subtract centroid to center around origin
          const vertices = geometry.coordinates.flat(2).map((val: number, idx: number) => {
            if (idx % 3 === 0) { // X coordinate
              return val - centroidX;
            } else if (idx % 3 === 1) { // Y coordinate
              return val - centroidY;
            } else { // Z coordinate
              return val - centroidZ;
            }
          });

          const geom = new THREE.BufferGeometry();
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
          // Subtract centroid to center around origin
          const vertices = geometry.coordinates.flat(2).map((val: number, idx: number) => {
            if (idx % 3 === 0) { // X coordinate
              return val - centroidX;
            } else if (idx % 3 === 1) { // Y coordinate
              return val - centroidY;
            } else { // Z coordinate
              return val - centroidZ;
            }
          });

          const geom = new THREE.BufferGeometry();
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

  console.log('[geojsonToThree] Final boundingBox:', boundingBox);
  console.log('[geojsonToThree] Object children count:', object.children.length);

  return { object, boundingBox };
}

// Helper function to transform a geometry's coordinates
function transformGeometry(geometry: any, sourceCRS: string) {
  const transformedGeometry = { ...geometry };

  switch (geometry.type) {
    case 'Point':
      transformedGeometry.coordinates = transformCoordinates(geometry.coordinates, sourceCRS);
      break;
    case 'MultiPoint':
    case 'LineString':
      transformedGeometry.coordinates = geometry.coordinates.map((coord: number[]) =>
        transformCoordinates(coord, sourceCRS)
      );
      break;
    case 'MultiLineString':
      transformedGeometry.coordinates = geometry.coordinates.map((line: number[][]) =>
        line.map((coord: number[]) => transformCoordinates(coord, sourceCRS))
      );
      break;
    case 'Polygon':
      transformedGeometry.coordinates = geometry.coordinates.map((ring: number[][]) =>
        ring.map((coord: number[]) => transformCoordinates(coord, sourceCRS))
      );
      break;
    case 'MultiPolygon':
      transformedGeometry.coordinates = geometry.coordinates.map((polygon: number[][][]) =>
        polygon.map((ring: number[][]) =>
          ring.map((coord: number[]) => transformCoordinates(coord, sourceCRS))
        )
      );
      break;
    case 'TIN':
    case 'PolyhedralSurface':
      transformedGeometry.coordinates = geometry.coordinates.map((face: number[][][]) =>
        face.map((ring: number[][]) =>
          ring.map((coord: number[]) => transformCoordinates(coord, sourceCRS))
        )
      );
      break;
  }

  return transformedGeometry;
}

// Helper function to collect coordinates from a geometry for centroid calculation
function collectCoordinatesFromGeometry(geometry: any, allCoordinates: number[][]) {
  switch (geometry.type) {
    case 'Point':
      allCoordinates.push(geometry.coordinates);
      break;
    case 'MultiPoint':
      allCoordinates.push(...geometry.coordinates);
      break;
    case 'LineString':
      allCoordinates.push(...geometry.coordinates);
      break;
    case 'MultiLineString':
      for (const lineString of geometry.coordinates) {
        allCoordinates.push(...lineString);
      }
      break;
    case 'Polygon':
      for (const ring of geometry.coordinates) {
        allCoordinates.push(...ring);
      }
      break;
    case 'MultiPolygon':
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          allCoordinates.push(...ring);
        }
      }
      break;
    case 'TIN':
      for (const triangle of geometry.coordinates) {
        for (const ring of triangle) {
          allCoordinates.push(...ring);
        }
      }
      break;
    case 'PolyhedralSurface':
      for (const polygon of geometry.coordinates) {
        for (const ring of polygon) {
          allCoordinates.push(...ring);
        }
      }
      break;
  }
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