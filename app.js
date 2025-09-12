// Global variables
let myLocation = null;
let connections = JSON.parse(localStorage.getItem('locationConnections') || '[]');

// Initialize the app
document.addEventListener('DOMContentLoaded', function() {
    getCurrentLocation();
    displayRecentConnections();
});

// Get current location
function getCurrentLocation() {
    const locationDisplay = document.getElementById('myLocation');
    
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                const accuracy = position.coords.accuracy;
                
                myLocation = { lat, lng, accuracy };
                
                locationDisplay.innerHTML = `
                    <div class="location-info">
                        <div class="location-item">
                            <strong>Latitude</strong>
                            <span>${lat.toFixed(6)}</span>
                        </div>
                        <div class="location-item">
                            <strong>Longitude</strong>
                            <span>${lng.toFixed(6)}</span>
                        </div>
                        <div class="location-item">
                            <strong>Accuracy</strong>
                            <span>${accuracy.toFixed(0)}m</span>
                        </div>
                        <div class="location-item">
                            <strong>Status</strong>
                            <span style="color: #28a745;">✓ Ready</span>
                        </div>
                    </div>
                `;
            },
            function(error) {
                locationDisplay.innerHTML = `
                    <div style="text-align: center; color: #dc3545; padding: 2rem;">
                        <h3>❌ Location Access Denied</h3>
                        <p>Please enable location access to use this feature.</p>
                        <button class="btn btn-primary" onclick="getCurrentLocation()">Try Again</button>
                    </div>
                `;
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    } else {
        locationDisplay.innerHTML = `
            <div style="text-align: center; color: #dc3545; padding: 2rem;">
                <h3>❌ Geolocation Not Supported</h3>
                <p>Your browser doesn't support geolocation.</p>
            </div>
        `;
    }
}

// Share current location
function shareMyLocation() {
    if (!myLocation) {
        alert('Please wait for your location to be detected first.');
        return;
    }
    
    const shareUrl = `shared-map.html?lat=${myLocation.lat}&lng=${myLocation.lng}&name=My Location`;
    copyToClipboard(shareUrl);
    
    alert('Location link copied to clipboard! Share this link with others.');
}

// Connect with other location
function connectWithOther() {
    const lat = parseFloat(document.getElementById('otherLat').value);
    const lng = parseFloat(document.getElementById('otherLng').value);
    const name = document.getElementById('otherName').value || 'Unknown Location';
    
    if (isNaN(lat) || isNaN(lng)) {
        alert('Please enter valid latitude and longitude values.');
        return;
    }
    
    if (lat < -90 || lat > 90) {
        alert('Latitude must be between -90 and 90.');
        return;
    }
    
    if (lng < -180 || lng > 180) {
        alert('Longitude must be between -180 and 180.');
        return;
    }
    
    // Save connection
    const connection = {
        id: Date.now(),
        lat,
        lng,
        name,
        timestamp: new Date().toISOString()
    };
    
    connections.unshift(connection);
    if (connections.length > 10) {
        connections = connections.slice(0, 10);
    }
    
    localStorage.setItem('locationConnections', JSON.stringify(connections));
    displayRecentConnections();
    
    // Open shared map
    const url = `shared-map.html?lat1=${myLocation.lat}&lng1=${myLocation.lng}&lat2=${lat}&lng2=${lng}&name1=My Location&name2=${name}`;
    window.open(url, '_blank');
}

// Display recent connections
function displayRecentConnections() {
    const container = document.getElementById('recentConnections');
    
    if (connections.length === 0) {
        container.innerHTML = '<p class="no-data">No recent connections</p>';
        return;
    }
    
    container.innerHTML = connections.map(conn => `
        <div class="connection-item">
            <div class="connection-info">
                <div class="connection-name">${conn.name}</div>
                <div class="connection-coords">${conn.lat.toFixed(4)}, ${conn.lng.toFixed(4)}</div>
            </div>
            <div class="connection-actions">
                <button class="btn btn-small btn-primary" onclick="viewConnection(${conn.lat}, ${conn.lng}, '${conn.name}')">View</button>
                <button class="btn btn-small btn-danger" onclick="removeConnection(${conn.id})">Remove</button>
            </div>
        </div>
    `).join('');
}

// View a connection
function viewConnection(lat, lng, name) {
    if (!myLocation) {
        alert('Please wait for your location to be detected first.');
        return;
    }
    
    const url = `shared-map.html?lat1=${myLocation.lat}&lng1=${myLocation.lng}&lat2=${lat}&lng2=${lng}&name1=My Location&name2=${name}`;
    window.open(url, '_blank');
}

// Remove a connection
function removeConnection(id) {
    connections = connections.filter(conn => conn.id !== id);
    localStorage.setItem('locationConnections', JSON.stringify(connections));
    displayRecentConnections();
}

// View my personal map
function viewMyMap() {
    if (!myLocation) {
        alert('Please wait for your location to be detected first.');
        return;
    }
    
    window.open('map.html', '_blank');
}

// Copy to clipboard
function copyToClipboard(text) {
    if (navigator.clipboard) {
        navigator.clipboard.writeText(text);
    } else {
        // Fallback for older browsers
        const textArea = document.createElement('textarea');
        textArea.value = text;
        document.body.appendChild(textArea);
        textArea.select();
        document.execCommand('copy');
        document.body.removeChild(textArea);
    }
}

// Calculate distance between two points (Haversine formula)
function calculateDistance(lat1, lng1, lat2, lng2) {
    const R = 6371; // Earth's radius in kilometers
    const dLat = (lat2 - lat1) * Math.PI / 180;
    const dLng = (lng2 - lng1) * Math.PI / 180;
    const a = Math.sin(dLat/2) * Math.sin(dLat/2) +
              Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) *
              Math.sin(dLng/2) * Math.sin(dLng/2);
    const c = 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1-a));
    return R * c;
}

// Format distance
function formatDistance(distance) {
    if (distance < 1) {
        return `${(distance * 1000).toFixed(0)} meters`;
    } else if (distance < 10) {
        return `${distance.toFixed(2)} km`;
    } else {
        return `${distance.toFixed(1)} km`;
    }
}