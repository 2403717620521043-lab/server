// Global variables
let socket;
let map;
let markers = [];
let myLocation = null;
let currentRole = null;
let currentName = null;
let isSharing = false;
let currentRequest = null;
let routePolyline = null;

// Initialize app
document.addEventListener('DOMContentLoaded', function() {
    try {
        socket = io();
        
        // Socket event listeners
        socket.on('role-selected', function(data) {
            currentRole = data.role;
            currentName = data.name;
            showMainApp();
        });
        
        socket.on('location-shared', function(data) {
            addLocationToMap(data);
            updateLocationsList();
        });
        
        socket.on('locations-data', function(locations) {
            clearMap();
            locations.forEach(location => {
                addLocationToMap(location);
            });
            updateLocationsList();
        });
        
        socket.on('user-offline', function(data) {
            removeLocationFromMap(data.id);
            updateLocationsList();
        });
        
        socket.on('new-request', function(data) {
            showRequestNotification(data);
        });
        
        socket.on('request-created', function(data) {
            currentRequest = data;
            showMessage('Request sent! Waiting for worker to accept...', 'success');
            updateRequestUI();
        });
        
        socket.on('request-accepted', function(data) {
            currentRequest = { ...currentRequest, status: 'accepted', ...data };
            showMessage('Request accepted! Route will be displayed.', 'success');
            showRoute(data.userLat, data.userLng, data.workerLat, data.workerLng);
            updateRequestUI();
        });
        
        socket.on('request-cancelled', function(data) {
            currentRequest = null;
            clearRoute();
            showMessage('Request cancelled', 'success');
            updateRequestUI();
        });
        
        socket.on('error', function(data) {
            showMessage(data.message, 'error');
        });
        
        socket.on('connect', function() {
            console.log('Connected to server');
        });
        
        socket.on('disconnect', function() {
            console.log('Disconnected from server');
        });
        
    } catch (error) {
        console.error('Error initializing app:', error);
        showMessage('Error connecting to server. Please refresh the page.', 'error');
    }
});

function selectRole(role) {
    const name = prompt(`Enter your name for ${role} role:`);
    if (name && name.trim()) {
        socket.emit('select-role', { role, name: name.trim() });
    }
}

function changeRole() {
    document.getElementById('roleSelection').style.display = 'flex';
    document.getElementById('mainApp').style.display = 'none';
    stopLocationSharing();
    clearRequest();
}

function showMainApp() {
    document.getElementById('roleSelection').style.display = 'none';
    document.getElementById('mainApp').style.display = 'block';
    
    document.getElementById('userRole').textContent = currentRole.charAt(0).toUpperCase() + currentRole.slice(1);
    document.getElementById('userName').textContent = currentName;
    
    const otherRole = currentRole === 'user' ? 'worker' : 'user';
    document.getElementById('otherRoleTitle').textContent = otherRole === 'worker' ? '👷 Workers' : '👤 Users';
    
    getCurrentLocation();
    loadOtherLocations();
    updateRequestUI();
}

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
                    <div class="location-item">
                        <strong>Latitude:</strong>
                        <span>${lat.toFixed(6)}</span>
                    </div>
                    <div class="location-item">
                        <strong>Longitude:</strong>
                        <span>${lng.toFixed(6)}</span>
                    </div>
                    <div class="location-item">
                        <strong>Accuracy:</strong>
                        <span>${accuracy.toFixed(0)}m</span>
                    </div>
                    <div class="location-item">
                        <strong>Status:</strong>
                        <span class="${isSharing ? 'status-online' : 'status-offline'}">
                            ${isSharing ? 'Sharing' : 'Not Sharing'}
                        </span>
                    </div>
                `;
                
                if (isSharing) {
                    socket.emit('location-update', { latitude: lat, longitude: lng, accuracy });
                }
            },
            function(error) {
                console.error('Geolocation error:', error);
                locationDisplay.innerHTML = `
                    <div class="error">
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
            <div class="error">
                <h3>❌ Geolocation Not Supported</h3>
                <p>Your browser doesn't support geolocation.</p>
            </div>
        `;
    }
}

function startLocationSharing() {
    if (!myLocation) {
        showMessage('Please wait for your location to be detected first.', 'error');
        return;
    }
    
    isSharing = true;
    socket.emit('location-update', {
        latitude: myLocation.lat,
        longitude: myLocation.lng,
        accuracy: myLocation.accuracy
    });
    
    showMessage('Location sharing started!', 'success');
    getCurrentLocation(); // Refresh display
}

function stopLocationSharing() {
    isSharing = false;
    showMessage('Location sharing stopped.', 'success');
    getCurrentLocation(); // Refresh display
}

function loadOtherLocations() {
    const otherRole = currentRole === 'user' ? 'worker' : 'user';
    socket.emit('get-locations', otherRole);
}

function refreshLocations() {
    loadOtherLocations();
    getCurrentLocation();
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
                ${currentRole === 'user' && location.role === 'worker' ? 
                    `<button class="btn btn-small btn-primary" onclick="sendRequest('${location.id}')" style="margin-top: 10px;">Send Request</button>` : 
                    ''
                }
                ${currentRole === 'worker' && location.role === 'user' ? 
                    `<button class="btn btn-small btn-success" onclick="acceptRequest('${location.id}')" style="margin-top: 10px;">Accept Request</button>` : 
                    ''
                }
            </div>
        `
    });
    
    marker.addListener('click', function() {
        infoWindow.open(map, marker);
    });
    
    markers.push({ id: location.id, marker, infoWindow });
    
    // Update map center if this is the first location
    if (markers.length === 1) {
        map.setCenter({ lat: location.latitude, lng: location.longitude });
        map.setZoom(15);
    } else {
        // Fit map to show all markers
        const bounds = new google.maps.LatLngBounds();
        markers.forEach(m => bounds.extend(m.marker.getPosition()));
        map.fitBounds(bounds);
    }
    
    updateMapInfo();
}

function sendRequest(workerId) {
    if (!myLocation) {
        showMessage('Please enable location sharing first.', 'error');
        return;
    }
    
    socket.emit('create-request', { workerId });
}

function acceptRequest(userId) {
    // This will be handled by the server when a request is created
    showMessage('Request accepted!', 'success');
}

function showRequestNotification(data) {
    if (currentRole === 'worker') {
        const notification = document.createElement('div');
        notification.className = 'request-notification';
        notification.innerHTML = `
            <div class="request-content">
                <h3>New Request from ${data.userName}</h3>
                <p>Location: ${data.userLat.toFixed(4)}, ${data.userLng.toFixed(4)}</p>
                <div class="request-actions">
                    <button class="btn btn-success" onclick="acceptRequestById(${data.requestId})">Accept</button>
                    <button class="btn btn-secondary" onclick="dismissNotification(this)">Dismiss</button>
                </div>
            </div>
        `;
        
        document.body.appendChild(notification);
        
        // Auto-dismiss after 30 seconds
        setTimeout(() => {
            if (notification.parentNode) {
                notification.remove();
            }
        }, 30000);
    }
}

function acceptRequestById(requestId) {
    socket.emit('accept-request', { requestId });
    dismissNotification(document.querySelector('.request-notification'));
}

function dismissNotification(element) {
    if (element && element.parentNode) {
        element.remove();
    }
}

function showRoute(userLat, userLng, workerLat, workerLng) {
    if (!map) return;
    
    // Clear existing route
    clearRoute();
    
    // Create directions service
    const directionsService = new google.maps.DirectionsService();
    const directionsRenderer = new google.maps.DirectionsRenderer({
        suppressMarkers: true,
        polylineOptions: {
            strokeColor: '#667eea',
            strokeWeight: 4,
            strokeOpacity: 0.8
        }
    });
    
    directionsRenderer.setMap(map);
    
    // Calculate route
    directionsService.route({
        origin: { lat: userLat, lng: userLng },
        destination: { lat: workerLat, lng: workerLng },
        travelMode: google.maps.TravelMode.DRIVING
    }, function(result, status) {
        if (status === 'OK') {
            directionsRenderer.setDirections(result);
            routePolyline = directionsRenderer;
            
            // Fit map to show the route
            const bounds = new google.maps.LatLngBounds();
            result.routes[0].legs[0].steps.forEach(step => {
                bounds.extend(step.start_location);
                bounds.extend(step.end_location);
            });
            map.fitBounds(bounds);
            
            showMessage('Route calculated successfully!', 'success');
        } else {
            console.error('Directions request failed:', status);
            showMessage('Failed to calculate route', 'error');
        }
    });
}

function clearRoute() {
    if (routePolyline) {
        routePolyline.setMap(null);
        routePolyline = null;
    }
}

function updateRequestUI() {
    const requestSection = document.getElementById('requestSection');
    if (!requestSection) return;
    
    if (currentRequest) {
        requestSection.innerHTML = `
            <div class="request-status">
                <h3>Current Request</h3>
                <p>Status: <span class="status-${currentRequest.status}">${currentRequest.status.toUpperCase()}</span></p>
                ${currentRequest.status === 'pending' ? 
                    '<button class="btn btn-danger" onclick="cancelRequest()">Cancel Request</button>' : 
                    '<button class="btn btn-secondary" onclick="clearRequest()">Clear</button>'
                }
            </div>
        `;
    } else {
        requestSection.innerHTML = '<p class="no-data">No active requests</p>';
    }
}

function cancelRequest() {
    if (currentRequest) {
        socket.emit('cancel-request', { requestId: currentRequest.requestId });
    }
}

function clearRequest() {
    currentRequest = null;
    clearRoute();
    updateRequestUI();
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
    clearRoute();
    updateMapInfo();
}

function updateMapInfo() {
    const count = markers.length;
    const activeCountElement = document.getElementById('activeCount');
    if (activeCountElement) {
        activeCountElement.textContent = count;
    }
    const mapInfoElement = document.getElementById('mapInfo');
    if (mapInfoElement) {
        mapInfoElement.style.display = count > 0 ? 'block' : 'none';
    }
}

function updateLocationsList() {
    const container = document.getElementById('otherLocations');
    if (!container) return;
    
    if (markers.length === 0) {
        container.innerHTML = '<p class="no-data">No locations available</p>';
        return;
    }
    
    container.innerHTML = markers.map(m => {
        const location = m.marker.getPosition();
        return `
            <div class="location-entry">
                <div class="location-entry-info">
                    <div class="location-entry-name">${m.marker.getTitle()}</div>
                    <div class="location-entry-coords">
                        ${location.lat().toFixed(6)}, ${location.lng().toFixed(6)}
                    </div>
                </div>
                <div class="location-entry-actions">
                    <button class="btn btn-small btn-primary" onclick="centerOnLocation('${m.id}')">View</button>
                </div>
            </div>
        `;
    }).join('');
}

function centerOnLocation(locationId) {
    const markerData = markers.find(m => m.id === locationId);
    if (markerData) {
        map.setCenter(markerData.marker.getPosition());
        map.setZoom(15);
        markerData.infoWindow.open(map, markerData.marker);
    }
}

function initMap() {
    try {
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
        console.log('Map initialized successfully');
    } catch (error) {
        console.error('Error initializing map:', error);
        showMessage('Error initializing map. Please check your Google Maps API key.', 'error');
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

// Handle API key error
window.gm_authFailure = function() {
    console.error('Google Maps API key error');
    showMessage('Google Maps API key error. Please check your API key.', 'error');
};

// Handle any uncaught errors
window.addEventListener('error', function(e) {
    console.error('Uncaught error:', e.error);
});