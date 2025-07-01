// import Adb from "../src/adb.js";

//async function main() {
//    const client = Adb.createClient();
//    const devices = await client.listDevices();
//    const device = client.getDevice(devices[0].id);
//    // const services = await device.getServices();
//    // console.log (services);
//    // const services = await device.checkService('location');
//    // console.log (services);
//    // service call serial 1  
//    // 1 => imei
//    // 19 => phone number
//    // for (let i = 0; i < 32; i++) {
//    //     console.log('iphonesubinfo', i);
//    //     try {
//    //         const services = await device.callServiceRaw('iphonesubinfo', i);
//    //         // console.log(services.length);
//    //         console.log(services.length, services.toString('utf-8'));
//    //         console.log(services.length, services.swap16().toString('ucs2'));
//    //     } catch (e) {
//    //         console.log(e);
//    //     }
//    // }
//}
//main()