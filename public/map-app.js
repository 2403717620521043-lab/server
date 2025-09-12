


// Global variables for map page
let socket;
let map;
let markers = [];

// Initialize map app
document.addEventListener('DOMContentLoaded', function() {
    socket = io();
    
    // Socket event listeners
    socket.on('location-shared', function(data) {
        addLocationToMap(data);
    });
    
    socket.on('locations-data', function(locations) {
        clearMap();
        locations.forEach(location => {
            addLocationToMap(location);
        });
    });
    
    socket.on('user-offline', function(data) {
        removeLocationFromMap(data.id);
    });
    
    socket.on('connect', function() {
        console.log('Connected to server');
    });
    
    socket.on('disconnect', function() {
        console.log('Disconnected from server');
    });
});

// This function is called by Google Maps API
function initMap() {
    console.log('Initializing map...');
    map = new google.maps.Map(document.getElementById('map'), {
        zoom: 10,
        center: { lat: 0, lng: 0 },
        mapTypeId: 'roadmap',
        styles: [
            {
                featureType: 'poi',
                elementType: 'labels',
                stylers: [{ visibility: 'off' }]
            }
        ]
    });
    
    // Get current location after map loads
    getCurrentLocation();
}

function getCurrentLocation() {
    if (navigator.geolocation) {
        navigator.geolocation.getCurrentPosition(
            function(position) {
                const lat = position.coords.latitude;
                const lng = position.coords.longitude;
                
                map.setCenter({ lat, lng });
                map.setZoom(15);
                
                // Add a marker for current location
                const currentMarker = new google.maps.Marker({
                    position: { lat, lng },
                    map: map,
                    title: 'Your Location',
                    icon: {
                        url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                            <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                                <circle cx="20" cy="20" r="18" fill="#667eea" stroke="#fff" stroke-width="4"/>
                                <circle cx="20" cy="20" r="8" fill="#fff"/>
                            </svg>
                        `),
                        scaledSize: new google.maps.Size(40, 40),
                        anchor: new google.maps.Point(20, 20)
                    }
                });
            },
            function(error) {
                console.error('Error getting location:', error);
                showMessage('Unable to get your location. Please check your browser settings.', 'error');
            },
            {
                enableHighAccuracy: true,
                timeout: 10000,
                maximumAge: 300000
            }
        );
    } else {
        console.error('Geolocation not supported');
        showMessage('Geolocation is not supported by this browser.', 'error');
    }
}

function addLocationToMap(location) {
    if (!map) {
        console.error('Map not initialized');
        return;
    }
    
    // Remove existing marker for this location
    removeLocationFromMap(location.id);
    
    const marker = new google.maps.Marker({
        position: { lat: location.latitude, lng: location.longitude },
        map: map,
        title: `${location.name} (${location.role})`,
        icon: {
            url: 'data:image/svg+xml;charset=UTF-8,' + encodeURIComponent(`
                <svg width="40" height="40" viewBox="0 0 40 40" xmlns="http://www.w3.org/2000/svg">
                    <circle cx="20" cy="20" r="18" fill="${location.role === 'user' ? '#e74c3c' : '#28a745'}" stroke="#fff" stroke-width="4"/>
                    <circle cx="20" cy="20" r="8" fill="#fff"/>
                </svg>
            `),
            scaledSize: new google.maps.Size(40, 40),
            anchor: new google.maps.Point(20, 20)
        }
    });
    
    const infoWindow = new google.maps.InfoWindow({
        content: `
            <div style="padding: 10px; text-align: center;">
                <h3 style="margin: 0 0 5px 0; color: #333;">${location.role === 'user' ? '👤' : '👷'} ${location.name}</h3>
                <p style="margin: 0; color: #666; font-size: 0.9rem;">
                    Role: ${location.role}<br>
                    Lat: ${location.latitude.toFixed(6)}<br>
                    Lng: ${location.longitude.toFixed(6)}
                </p>
            </div>
        `
    });
    
    marker.addListener('click', function() {
        infoWindow.open(map, marker);
    });
    
    markers.push({ id: location.id, marker, infoWindow });
    updateMapInfo();
}

function removeLocationFromMap(locationId) {
    const index = markers.findIndex(m => m.id === locationId);
    if (index !== -1) {
        markers[index].marker.setMap(null);
        if (markers[index].infoWindow) {
            markers[index].infoWindow.close();
        }
        markers.splice(index, 1);
        updateMapInfo();
    }
}

function clearMap() {
    markers.forEach(m => {
        m.marker.setMap(null);
        if (m.infoWindow) {
            m.infoWindow.close();
        }
    });
    markers = [];
    updateMapInfo();
}

function updateMapInfo() {
    const count = markers.length;
    const activeCountElement = document.getElementById('activeCount');
    if (activeCountElement) {
        activeCountElement.textContent = count;
    }
}

function showMessage(message, type) {
    // Remove existing messages
    const existingMessages = document.querySelectorAll('.message');
    existingMessages.forEach(msg => msg.remove());
    
    const messageDiv = document.createElement('div');
    messageDiv.className = `message ${type}`;
    messageDiv.textContent = message;
    messageDiv.style.position = 'fixed';
    messageDiv.style.top = '20px';
    messageDiv.style.right = '20px';
    messageDiv.style.zIndex = '10000';
    messageDiv.style.padding = '1rem';
    messageDiv.style.borderRadius = '10px';
    messageDiv.style.color = 'white';
    messageDiv.style.fontWeight = '500';
    messageDiv.style.boxShadow = '0 4px 12px rgba(0,0,0,0.3)';
    
    if (type === 'success') {
        messageDiv.style.background = '#28a745';
    } else {
        messageDiv.style.background = '#dc3545';
    }
    
    document.body.appendChild(messageDiv);
    
    setTimeout(() => {
        messageDiv.remove();
    }, 3000);
}

// Handle Google Maps API errors
window.gm_authFailure = function() {
    console.error('Google Maps API key error');
    showMessage('Google Maps API key error. Please check your API key.', 'error');
};

// Handle any uncaught errors
window.addEventListener('error', function(e) {
    console.error('Uncaught error:', e.error);
});