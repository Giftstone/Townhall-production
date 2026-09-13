// client/src/components/IncidentMap.jsx
import { MapContainer, TileLayer, Marker, Popup } from 'react-leaflet';
import 'leaflet/dist/leaflet.css';
import L from 'leaflet';
import markerIcon2x from 'leaflet/dist/images/marker-icon-2x.png';
import markerIcon from 'leaflet/dist/images/marker-icon.png';
import markerShadow from 'leaflet/dist/images/marker-shadow.png';

// Fix for default marker icon issues with React-Leaflet
delete L.Icon.Default.prototype._getIconUrl;
L.Icon.Default.mergeOptions({
  iconUrl: markerIcon,
  iconRetinaUrl: markerIcon2x,
  shadowUrl: markerShadow,
});

export default function IncidentMap({ reports }) {
  // Zambia center
  const defaultPos = [-13.1339, 27.8493];
  const defaultZoom = reports && reports.some(r => r.latitude) ? 7 : 6;

  return (
    <MapContainer center={defaultPos} zoom={defaultZoom} style={{ height: '400px', width: '100%', marginTop: '1rem' }}>
      <TileLayer
        attribution='&copy; OpenStreetMap contributors'
        url="https://{s}.tile.openstreetmap.org/{z}/{x}/{y}.png"
      />
      {reports.map(r => (
        r.latitude && r.longitude && (
          <Marker key={r.id} position={[r.latitude, r.longitude]}>
            <Popup>
              <strong>{r.title}</strong><br />
              {r.description}<br />
              <em>Status: {r.status}</em>
            </Popup>
          </Marker>
        )
      ))}
    </MapContainer>
  );
}