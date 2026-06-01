export const devices = [
  { 
    id: 1, name: "Truck-01", type: "truck",
    lat: 19.076, lng: 72.877, 
    speed: 45, status: "online",
    driver: "Ramesh Kumar", phone: "+91-9876543210",
    fuel: 67, battery: 85, ignition: true,
    address: "Andheri West, Mumbai",
    lastUpdate: "2 mins ago",
    totalDistance: "1,240 km"
  },
  { 
    id: 2, name: "Car-02", type: "car",
    lat: 19.085, lng: 72.890,
    speed: 0, status: "offline",
    driver: "Suresh Singh", phone: "+91-9876543211",
    fuel: 23, battery: 45, ignition: false,
    address: "Bandra East, Mumbai",
    lastUpdate: "1 hour ago",
    totalDistance: "890 km"
  },
  { 
    id: 3, name: "Bike-03", type: "motorcycle",
    lat: 19.070, lng: 72.865,
    speed: 30, status: "online",
    driver: "Amit Sharma", phone: "+91-9876543212",
    fuel: 89, battery: 92, ignition: true,
    address: "Kurla, Mumbai",
    lastUpdate: "Just now",
    totalDistance: "456 km"
  },
  { 
    id: 4, name: "Van-04", type: "van",
    lat: 19.095, lng: 72.855,
    speed: 12, status: "online",
    driver: "Vijay Patel", phone: "+91-9876543213",
    fuel: 45, battery: 78, ignition: true,
    address: "Goregaon, Mumbai",
    lastUpdate: "5 mins ago",
    totalDistance: "2,100 km"
  },
  { 
    id: 5, name: "Truck-05", type: "truck",
    lat: 19.060, lng: 72.900,
    speed: 0, status: "offline",
    driver: "Manoj Yadav", phone: "+91-9876543214",
    fuel: 12, battery: 30, ignition: false,
    address: "Chembur, Mumbai",
    lastUpdate: "3 hours ago",
    totalDistance: "3,450 km"
  }
];

export const mockTrips = [
  { id:1, start:"06:00 AM", end:"09:30 AM", 
    distance:"45.2 km", duration:"3h 30m", 
    from:"Andheri", to:"Thane" },
  { id:2, start:"11:00 AM", end:"12:15 PM",
    distance:"18.7 km", duration:"1h 15m",
    from:"Thane", to:"Vashi" },
  { id:3, start:"02:30 PM", end:"04:00 PM",
    distance:"32.1 km", duration:"1h 30m",
    from:"Vashi", to:"Andheri" }
];

export const mockReportData = [
  { time:"06:00", location:"Andheri West", speed:"0 km/h", distance:"0 km" },
  { time:"06:15", location:"Western Express Hwy", speed:"55 km/h", distance:"8.2 km" },
  { time:"06:45", location:"Borivali", speed:"42 km/h", distance:"22.5 km" },
  { time:"07:30", location:"Dahisar", speed:"38 km/h", distance:"31.0 km" },
  { time:"08:00", location:"Mira Road", speed:"60 km/h", distance:"38.7 km" },
  { time:"09:30", location:"Thane", speed:"0 km/h", distance:"45.2 km" }
];
