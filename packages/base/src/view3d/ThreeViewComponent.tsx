import {
  IJupyterGISModel,
  IJGISLayer,
  IJGISLayerDocChange,
} from '@jupytergis/schema';
import * as React from 'react';
import * as THREE from 'three';
import { OrbitControls } from 'three/examples/jsm/controls/OrbitControls';

import {
  geojsonToThree,
  computeCameraPosition,
  GeoJSONToThreeOptions,
  ConversionResult,
} from './geojsonToThree';

export interface IThreeViewProps {
  gisModel: IJupyterGISModel;
  geojson: any | null;
  onViewChange: (active: boolean) => void;
  onClose: () => void;
  backgroundColor?: number;
  conversionOptions?: GeoJSONToThreeOptions;
  onReady?: (viewer: ThreeViewer) => void;
}

interface IThreeViewState {
  isLoading: boolean;
  error: string | null;
}

export class ThreeViewer {
  private scene: THREE.Scene;
  private camera: THREE.PerspectiveCamera;
  private renderer: THREE.WebGLRenderer;
  private controls: OrbitControls;
  private currentObject: THREE.Object3D | null = null;
  private animationId: number | null = null;

  constructor(canvas: HTMLCanvasElement, width: number, height: number) {
    this.scene = new THREE.Scene();
    this.scene.background = new THREE.Color(0xf0f0f0);
    // Increase the near/far clipping planes to accommodate large coordinate differences
    this.camera = new THREE.PerspectiveCamera(50, width / height, 0.01, 1000000);
    this.camera.position.set(100, -100, 100);
    this.camera.up.set(0, 0, 1);
    this.renderer = new THREE.WebGLRenderer({
      canvas,
      antialias: true,
      alpha: true,
    });
    this.renderer.setSize(width, height);
    this.renderer.setPixelRatio(window.devicePixelRatio);
    this.controls = new OrbitControls(this.camera, this.renderer.domElement);
    this.controls.enableDamping = true;
    this.controls.dampingFactor = 0.05;
    this.setupLights(); // Call without parameter during initialization
    // Don't add grid helper initially - it will be added after data is loaded
    // and we know the scale
    const axesHelper = new THREE.AxesHelper(50);
    this.scene.add(axesHelper);
    this.animate();
  }

  private setupLights(maxDimension?: number): void {
    // Clear existing lights with defensive programming to handle potential undefined children
    try {
      this.scene.traverse((obj) => {
        if (obj && obj instanceof THREE.Light) {
          this.scene.remove(obj);
        }
      });
    } catch (error) {
      console.warn('Error during scene traversal in setupLights:', error);
      // If traversal fails, manually iterate through children to remove lights
      for (let i = this.scene.children.length - 1; i >= 0; i--) {
        const child = this.scene.children[i];
        if (child && child instanceof THREE.Light) {
          this.scene.remove(child);
        }
      }
    }

    const ambient = new THREE.AmbientLight(0xffffff, 0.6);
    this.scene.add(ambient);

    // Position directional light based on the scale of the data
    const lightDistance = maxDimension ? Math.max(maxDimension * 0.5, 100) : 100;
    const directional = new THREE.DirectionalLight(0xffffff, 0.8);
    directional.position.set(lightDistance, lightDistance, lightDistance);
    directional.castShadow = true;
    this.scene.add(directional);

    const hemisphere = new THREE.HemisphereLight(0x87ceeb, 0x545454, 0.4);
    this.scene.add(hemisphere);
  }

  private animate = (): void => {
    this.animationId = requestAnimationFrame(this.animate);
    this.controls.update();
    this.renderer.render(this.scene, this.camera);
  };

  loadGeoJSON(geojson: any, options: GeoJSONToThreeOptions = {}): void {
    if (this.currentObject) {
      this.scene.remove(this.currentObject);
      this.disposeObject(this.currentObject);
      this.currentObject = null;
    }

    // Remove any existing grid helpers with defensive programming
    try {
      this.scene.traverse((obj) => {
        if (obj && obj instanceof THREE.GridHelper) {
          this.scene.remove(obj);
        }
      });
    } catch (error) {
      console.warn('Error during scene traversal to remove grid helpers:', error);
      // If traversal fails, manually iterate through children to remove grid helpers
      for (let i = this.scene.children.length - 1; i >= 0; i--) {
        const child = this.scene.children[i];
        if (child && child instanceof THREE.GridHelper) {
          this.scene.remove(child);
        }
      }
    }

    if (!geojson) {
      return;
    }

    try {
      const result: ConversionResult = geojsonToThree(geojson, options);
      this.currentObject = result.object;
      this.scene.add(this.currentObject);

      // Calculate the size of the bounding box to determine appropriate scale for helpers
      const size = result.boundingBox.getSize(new THREE.Vector3());
      const maxDimension = Math.max(size.x, size.y, size.z);

      // Add grid helper with appropriate scale based on data dimensions
      const gridSize = Math.min(Math.ceil(maxDimension * 1.2), 1000000); // Limit to 1M units max
      const gridDivisions = Math.min(Math.floor(gridSize / 10), 1000); // Limit divisions

      const gridHelper = new THREE.GridHelper(gridSize, gridDivisions, 0x888888, 0xcccccc);
      gridHelper.rotation.x = Math.PI / 2;
      this.scene.add(gridHelper);

      // Adjust lights based on the scale of the data
      this.setupLights(maxDimension);

      const cameraPos = computeCameraPosition(result.boundingBox);
      this.camera.position.copy(cameraPos);

      // Set the controls target to the center of the bounding box instead of origin
      const center = new THREE.Vector3();
      result.boundingBox.getCenter(center);
      this.controls.target.copy(center);
      this.controls.update();
    } catch (error) {
      console.error('Error loading GeoJSON into Three.js:', error);
      throw error;
    }
  }

  private disposeObject(object: THREE.Object3D): void {
    try {
      object.traverse((child: THREE.Object3D) => {
        if (child && child instanceof THREE.Mesh) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m: THREE.Material) => m && m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
        } else if (child && child instanceof THREE.Line) {
          child.geometry.dispose();
          if (Array.isArray(child.material)) {
            child.material.forEach((m: THREE.Material) => m && m.dispose());
          } else if (child.material) {
            child.material.dispose();
          }
        }
      });
    } catch (error) {
      console.warn('Error during object traversal in disposeObject:', error);
      // If traversal fails, manually dispose of the object's geometry and materials
      if (object instanceof THREE.Mesh) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m && m.dispose());
        } else if (object.material) {
          object.material.dispose();
        }
      } else if (object instanceof THREE.Line) {
        object.geometry?.dispose();
        if (Array.isArray(object.material)) {
          object.material.forEach(m => m && m.dispose());
        } else if (object.material) {
          object.material.dispose();
        }
      }
    }
  }

  resize(width: number, height: number): void {
    this.camera.aspect = width / height;
    this.camera.updateProjectionMatrix();
    this.renderer.setSize(width, height);
  }

  setBackgroundColor(color: number): void {
    this.scene.background = new THREE.Color(color);
  }

  resetCamera(): void {
    this.camera.position.set(100, -100, 100);
    this.controls.target.set(0, 0, 0);
    this.controls.update();
  }

  fitToObject(): void {
    if (!this.currentObject) {
      return;
    }

    const box = new THREE.Box3().setFromObject(this.currentObject);
    const cameraPos = computeCameraPosition(box);
    this.camera.position.copy(cameraPos);

    const center = new THREE.Vector3();
    box.getCenter(center);
    this.controls.target.copy(center);
    this.controls.update();
  }

  setWireframeVisible(visible: boolean): void {
    if (!this.currentObject) {
      return;
    }

    try {
      this.currentObject.traverse((child: THREE.Object3D) => {
        if (
          child &&
          (child instanceof THREE.LineSegments ||
          child instanceof THREE.LineLoop)
        ) {
          child.visible = visible;
        }
      });
    } catch (error) {
      console.warn('Error during object traversal in setWireframeVisible:', error);
      // If traversal fails, manually handle the visibility
      if (
        this.currentObject instanceof THREE.LineSegments ||
        this.currentObject instanceof THREE.LineLoop
      ) {
        this.currentObject.visible = visible;
      }
    }
  }

  setOpacity(opacity: number): void {
    if (!this.currentObject) {
      return;
    }

    try {
      this.currentObject.traverse((child: THREE.Object3D) => {
        if (child && child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshPhongMaterial;
          if (material) {
            material.opacity = opacity;
            material.transparent = opacity < 1;
            material.needsUpdate = true;
          }
        }
      });
    } catch (error) {
      console.warn('Error during object traversal in setOpacity:', error);
      // If traversal fails, manually handle opacity if currentObject is a Mesh
      if (this.currentObject instanceof THREE.Mesh) {
        const material = this.currentObject.material as THREE.MeshPhongMaterial;
        if (material) {
          material.opacity = opacity;
          material.transparent = opacity < 1;
          material.needsUpdate = true;
        }
      }
    }
  }

  setColor(color: number): void {
    if (!this.currentObject) {
      return;
    }

    try {
      this.currentObject.traverse((child: THREE.Object3D) => {
        if (child && child instanceof THREE.Mesh) {
          const material = child.material as THREE.MeshPhongMaterial;
          if (material) {
            material.color.setHex(color);
            material.needsUpdate = true;
          }
        }
      });
    } catch (error) {
      console.warn('Error during object traversal in setColor:', error);
      // If traversal fails, manually handle color if currentObject is a Mesh
      if (this.currentObject instanceof THREE.Mesh) {
        const material = this.currentObject.material as THREE.MeshPhongMaterial;
        if (material) {
          material.color.setHex(color);
          material.needsUpdate = true;
        }
      }
    }
  }

  screenshot(): string {
    this.renderer.render(this.scene, this.camera);
    return this.renderer.domElement.toDataURL('image/png');
  }

  dispose(): void {
    if (this.animationId !== null) {
      cancelAnimationFrame(this.animationId);
    }

    this.controls.dispose();

    if (this.currentObject) {
      this.disposeObject(this.currentObject);
    }

    try {
      this.scene.traverse((child: THREE.Object3D) => {
        if (child && (child instanceof THREE.Mesh || child instanceof THREE.Line)) {
          this.disposeObject(child);
        }
      });
    } catch (error) {
      console.warn('Error during scene traversal in dispose:', error);
      // If traversal fails, manually dispose of objects in the scene
      for (let i = this.scene.children.length - 1; i >= 0; i--) {
        const child = this.scene.children[i];
        if (child && (child instanceof THREE.Mesh || child instanceof THREE.Line)) {
          this.disposeObject(child);
        }
      }
    }

    this.renderer.dispose();
  }
}

export class ThreeView extends React.Component<
  IThreeViewProps,
  IThreeViewState
> {
  private canvasRef = React.createRef<HTMLCanvasElement>();
  private viewer: ThreeViewer | null = null;
  private gisModel: IJupyterGISModel;

  constructor(props: IThreeViewProps) {
    super(props);
    this.state = {
      isLoading: false,
      error: null,
    };
    this.gisModel = this.props.gisModel;
  }

  componentDidMount(): void {
    if (this.canvasRef.current) {
      // Assuming parent div provides width and height
      const parent = this.canvasRef.current.parentElement;
      if (!parent) return;

      const { width, height } = parent.getBoundingClientRect();
      this.viewer = new ThreeViewer(this.canvasRef.current, width, height);

      if (this.props.backgroundColor !== undefined) {
        this.viewer.setBackgroundColor(this.props.backgroundColor);
      }

      if (this.props.geojson) {
        this.loadGeometry(this.props.geojson);
      }

      if (this.props.onReady) {
        this.props.onReady(this.viewer);
      }
    }
    this.gisModel.sharedLayersChanged.connect(this._onLayersChanged);
  }

  componentDidUpdate(prevProps: IThreeViewProps): void {
    if (!this.viewer) {
      return;
    }

    // Handle new geojson
    if (prevProps.geojson !== this.props.geojson) {
      this.loadGeometry(this.props.geojson);
    }

    // Handle background color change
    if (
      prevProps.backgroundColor !== this.props.backgroundColor &&
      this.props.backgroundColor !== undefined
    ) {
      this.viewer.setBackgroundColor(this.props.backgroundColor);
    }
  }

  componentWillUnmount(): void {
    if (this.viewer) {
      this.viewer.dispose();
      this.viewer = null;
    }
    this.gisModel.sharedLayersChanged.disconnect(this._onLayersChanged);
  }

  private _onLayersChanged = (
    _: any,
    change: IJGISLayerDocChange,
  ): void => {
    if (!this.viewer || !this.props.geojson) {
      return;
    }

    // Heuristic: For now, lets assume the 3D view displays the first vector layer
    // with 3D geometries. A more robust solution would be to track which layer
    // is being displayed in the 3D view.
    const layers = this.gisModel.getLayers();
    let layer3DId: string | undefined = undefined;

    for (const [id, layer] of Object.entries(layers) as [string, any][]) {
      if (layer.parameters?.extrude) {
        layer3DId = id;
        break;
      }
    }

    if (!layer3DId) {
      return;
    }

    change.layerChange?.forEach((c: any) => {
      if (c.id === layer3DId) {
        this.updateObjectProperties(c.newValue);
      }
    });
  };

  private updateObjectProperties(layer: IJGISLayer | undefined) {
    if (!this.viewer || !layer) {
      return;
    }

    if (layer.visible !== undefined) {
      this.viewer.setWireframeVisible(layer.visible);
    }

    const vectorParams = layer.parameters as any;
    if (vectorParams.opacity !== undefined) {
      this.viewer.setOpacity(vectorParams.opacity);
    }
    if (vectorParams.color) {
      this.viewer.setColor(new THREE.Color(vectorParams.color).getHex());
    }
  }

  private loadGeometry(geojson: any): void {
    if (!this.viewer || !geojson) {
      return;
    }

    this.setState({ isLoading: true, error: null });

    try {
      this.viewer.loadGeoJSON(geojson, this.props.conversionOptions);

      // Apply initial properties
      const layers = Object.values(this.gisModel.getLayers()) as IJGISLayer[];
      const layer3D = layers.find(l => l.parameters?.extrude);
      this.updateObjectProperties(layer3D);

      this.setState({ isLoading: false });
    } catch (error: any) {
      console.error('Error loading geometry:', error);
      this.setState({
        isLoading: false,
        error: error.message || 'Failed to load geometry',
      });
    }
  }

  render(): React.ReactNode {
    const { onClose } = this.props;
    const { isLoading, error } = this.state;

    return (
      <div className="jgis-three-view-container">
        <div className="jgis-three-view-header">
          <h3>3D View</h3>
          <button onClick={onClose} className="jgis-three-view-close">
            ×
          </button>
        </div>
        <div
          className="jgis-three-view"
          style={{ position: 'relative', flex: 1 }}
        >
          <canvas
            ref={this.canvasRef}
            style={{
              display: 'block',
              width: '100%',
              height: '100%',
            }}
          />

          {isLoading && (
            <div className="jgis-three-view-overlay">Loading 3D view...</div>
          )}

          {error && (
            <div className="jgis-three-view-error">Error: {error}</div>
          )}
        </div>
      </div>
    );
  }
}
