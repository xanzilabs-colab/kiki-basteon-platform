package za.co.xanzi.kiki

import android.Manifest
import android.bluetooth.BluetoothAdapter
import android.bluetooth.BluetoothDevice
import android.bluetooth.BluetoothGatt
import android.bluetooth.BluetoothGattCallback
import android.bluetooth.BluetoothGattCharacteristic
import android.bluetooth.BluetoothGattDescriptor
import android.bluetooth.BluetoothManager
import android.bluetooth.BluetoothProfile
import android.bluetooth.le.BluetoothLeScanner
import android.bluetooth.le.ScanCallback
import android.bluetooth.le.ScanResult
import android.bluetooth.le.ScanSettings
import android.content.pm.PackageManager
import android.os.Build
import android.os.Handler
import android.os.Looper
import android.widget.ArrayAdapter
import androidx.appcompat.app.AlertDialog
import androidx.core.content.ContextCompat
import com.getcapacitor.JSObject
import com.getcapacitor.PermissionState
import com.getcapacitor.Plugin
import com.getcapacitor.PluginCall
import com.getcapacitor.PluginMethod
import com.getcapacitor.annotation.CapacitorPlugin
import com.getcapacitor.annotation.Permission
import com.getcapacitor.annotation.PermissionCallback
import java.util.UUID

@CapacitorPlugin(
    name = "BasteonBle",
    permissions = [
        Permission(
            strings = [Manifest.permission.BLUETOOTH_CONNECT, Manifest.permission.BLUETOOTH_SCAN],
            alias = "bluetooth"
        ),
        Permission(strings = [Manifest.permission.ACCESS_FINE_LOCATION], alias = "bleLocation")
    ]
)
class BasteonBlePlugin : Plugin() {
    private val handler = Handler(Looper.getMainLooper())
    private val devices = LinkedHashMap<String, FoundDevice>()
    private var scanCall: PluginCall? = null
    private var scanner: BluetoothLeScanner? = null
    private var scanCallback: ScanCallback? = null
    private var scanTimeout: Runnable? = null
    private var scanDialog: AlertDialog? = null
    private var scanAdapter: ArrayAdapter<String>? = null
    private var scanCandidates: List<FoundDevice> = emptyList()
    private var activeSession: BandSession? = null

    private data class FoundDevice(
        val device: BluetoothDevice,
        val name: String,
        val isBasteon: Boolean
    )

    private class BandSession(
        val id: String,
        val device: BluetoothDevice,
        val name: String,
        var gatt: BluetoothGatt? = null,
        var info: BluetoothGattCharacteristic? = null,
        var token: BluetoothGattCharacteristic? = null,
        var status: BluetoothGattCharacteristic? = null,
        var ctrl: BluetoothGattCharacteristic? = null,
        var nonce: BluetoothGattCharacteristic? = null,
        var rawInfo: String = "",
        var pendingCall: PluginCall? = null,
        var pendingOperation: String? = null
    )

    @PluginMethod
    fun connectBand(call: PluginCall) {
        if (Build.VERSION.SDK_INT >= 31 && getPermissionState("bluetooth") != PermissionState.GRANTED) {
            requestPermissionForAlias("bluetooth", call, "bluetoothPermissionResult")
            return
        }
        if (Build.VERSION.SDK_INT < 31 && getPermissionState("bleLocation") != PermissionState.GRANTED) {
            requestPermissionForAlias("bleLocation", call, "bleLocationPermissionResult")
            return
        }
        startBandScan(call)
    }

    @PermissionCallback
    private fun bluetoothPermissionResult(call: PluginCall) {
        if (getPermissionState("bluetooth") != PermissionState.GRANTED) {
            call.reject("Allow nearby-device access to find your Kiki band.")
            return
        }
        startBandScan(call)
    }

    @PermissionCallback
    private fun bleLocationPermissionResult(call: PluginCall) {
        if (getPermissionState("bleLocation") != PermissionState.GRANTED) {
            call.reject("Allow location access while searching for Bluetooth devices on this Android version.")
            return
        }
        startBandScan(call)
    }

    private fun startBandScan(call: PluginCall) {
        if (scanCall != null) {
            call.reject("A Bluetooth search is already in progress.")
            return
        }
        val adapter = bluetoothAdapter()
        if (adapter == null) {
            call.reject("This phone does not have Bluetooth LE.")
            return
        }
        if (!adapter.isEnabled) {
            call.reject("Turn on Bluetooth, then search for your Kiki band again.")
            return
        }
        if (activeSession != null) closeSession(activeSession!!)

        val bleScanner = adapter.bluetoothLeScanner
        if (bleScanner == null) {
            call.reject("Android could not start Bluetooth scanning. Turn Bluetooth off and on, then try again.")
            return
        }
        devices.clear()
        scanCall = call
        call.setKeepAlive(true)
        scanner = bleScanner
        val showAll = call.getBoolean("showAll", false) ?: false
        scanCallback = object : ScanCallback() {
            override fun onScanResult(callbackType: Int, result: ScanResult) {
                val record = result.scanRecord
                val advertisedName = record?.deviceName?.takeIf { it.isNotBlank() }
                val deviceName = advertisedName ?: try {
                    result.device.name
                } catch (_: SecurityException) {
                    null
                }
                val hasService = record?.serviceUuids?.any { it.uuid == SERVICE_UUID } == true
                val name = deviceName?.takeIf { it.isNotBlank() } ?: "Bluetooth device"
                val matches = hasService || name.startsWith("Kiki", ignoreCase = true) ||
                    name.startsWith("Basteon", ignoreCase = true)
                if (showAll || matches) {
                    devices[result.device.address] = FoundDevice(result.device, name, matches)
                    updateScanDialog(showAll)
                }
            }

            override fun onScanFailed(errorCode: Int) {
                stopScan()
                val call = scanCall
                scanCall = null
                dismissScanDialog()
                rejectCall(call, "Bluetooth scan failed (code $errorCode). Check Bluetooth and try again.")
            }
        }

        try {
            bleScanner.startScan(
                null,
                ScanSettings.Builder().setScanMode(ScanSettings.SCAN_MODE_LOW_LATENCY).build(),
                scanCallback
            )
            activity.runOnUiThread { showScanDialog(showAll) }
            scanTimeout = Runnable { finishScan(showAll) }
            handler.postDelayed(scanTimeout!!, SCAN_DURATION_MS)
        } catch (error: SecurityException) {
            stopScan()
            dismissScanDialog()
            scanCall = null
            rejectCall(call, "Android denied Bluetooth scanning. Allow nearby-device access and try again.")
        } catch (error: IllegalStateException) {
            stopScan()
            dismissScanDialog()
            scanCall = null
            rejectCall(call, "Bluetooth is not ready to scan. Turn Bluetooth off and on, then try again.")
        }
    }

    private fun showScanDialog(showAll: Boolean) {
        val adapter = ArrayAdapter(activity, android.R.layout.simple_list_item_1, mutableListOf("Searching nearby…"))
        scanAdapter = adapter
        scanCandidates = emptyList()
        scanDialog = AlertDialog.Builder(activity)
            .setTitle(if (showAll) "Searching for Bluetooth devices" else "Searching for your Kiki band")
            .setMessage("Keep your band close and in link mode. Nearby devices will appear here.")
            .setAdapter(adapter) { _, index ->
                val call = scanCall ?: return@setAdapter
                val candidate = scanCandidates.getOrNull(index) ?: return@setAdapter
                scanCall = null
                stopScan()
                dismissScanDialog()
                connectSelectedDevice(call, candidate)
            }
            .setNegativeButton("Cancel") { _, _ -> cancelScan() }
            .setOnCancelListener { cancelScan() }
            .create()
        scanDialog?.show()
        updateScanDialog(showAll)
    }

    private fun updateScanDialog(showAll: Boolean) {
        val candidates = devices.values
            .filter { showAll || it.isBasteon }
            .sortedBy { it.name.lowercase() }
        activity.runOnUiThread {
            scanCandidates = candidates
            val adapter = scanAdapter ?: return@runOnUiThread
            adapter.clear()
            if (candidates.isEmpty()) {
                adapter.add("Searching nearby…")
            } else {
                candidates.forEach { adapter.add("${it.name} · ${it.device.address.takeLast(5)}") }
            }
            scanDialog?.setTitle(
                when {
                    candidates.isEmpty() -> if (showAll) "Searching for Bluetooth devices" else "Searching for your Kiki band"
                    showAll -> "Choose a Bluetooth device"
                    else -> "Choose your Kiki band"
                }
            )
        }
    }

    private fun finishScan(showAll: Boolean) {
        stopScan()
        val call = scanCall ?: return
        val candidates = devices.values.filter { showAll || it.isBasteon }
        if (candidates.isEmpty()) {
            scanCall = null
            dismissScanDialog()
            rejectCall(
                call,
                if (showAll) "No Bluetooth devices were found. Keep your Kiki band close and in double-blink link mode, then try again."
                else "No Kiki band was found. Keep it close and in double-blink link mode, or choose “Show all Bluetooth devices”."
            )
            return
        }
        updateScanDialog(showAll)
    }

    private fun cancelScan() {
        val call = scanCall
        scanCall = null
        stopScan()
        dismissScanDialog()
        rejectCall(call, "Bluetooth device selection cancelled.")
    }

    private fun dismissScanDialog() {
        val dialog = scanDialog
        scanDialog = null
        scanAdapter = null
        scanCandidates = emptyList()
        if (dialog != null) activity.runOnUiThread { dialog.dismiss() }
    }

    private fun connectSelectedDevice(call: PluginCall, found: FoundDevice) {
        val session = BandSession(UUID.randomUUID().toString(), found.device, found.name)
        activeSession = session
        session.pendingCall = call
        session.pendingOperation = "connect"
        val callback = object : BluetoothGattCallback() {
            override fun onConnectionStateChange(gatt: BluetoothGatt, status: Int, newState: Int) {
                activity.runOnUiThread {
                    if (activeSession !== session) return@runOnUiThread
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        failSession(session, "Could not connect to the band (Bluetooth error $status). Keep it close and in link mode.")
                    } else if (newState == BluetoothProfile.STATE_CONNECTED) {
                        try {
                            if (Build.VERSION.SDK_INT >= 21 && gatt.requestMtu(247)) return@runOnUiThread
                            if (!gatt.discoverServices()) {
                                failSession(session, "Android could not read the band's Bluetooth services.")
                            }
                        } catch (error: SecurityException) {
                            failSession(session, "Android denied access to the Bluetooth connection.")
                        }
                    } else if (newState == BluetoothProfile.STATE_DISCONNECTED) {
                        if (session.pendingCall != null) {
                            failSession(session, "The band disconnected while connecting. Keep it close and try again.")
                        } else {
                            notifyListeners("bandDisconnected", JSObject().put("id", session.id))
                            closeSession(session)
                        }
                    }
                }
            }

            override fun onMtuChanged(gatt: BluetoothGatt, mtu: Int, status: Int) {
                activity.runOnUiThread {
                    if (activeSession === session && !gatt.discoverServices()) {
                        failSession(session, "Android could not read the band's Bluetooth services.")
                    }
                }
            }

            override fun onServicesDiscovered(gatt: BluetoothGatt, status: Int) {
                activity.runOnUiThread {
                    if (activeSession !== session) return@runOnUiThread
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        failSession(session, "The band did not expose its Bluetooth service. Make sure it is in link mode.")
                        return@runOnUiThread
                    }
                    val service = gatt.getService(SERVICE_UUID)
                    session.info = service?.getCharacteristic(INFO_UUID)
                    session.token = service?.getCharacteristic(TOKEN_UUID)
                    session.status = service?.getCharacteristic(STATUS_UUID)
                    session.ctrl = service?.getCharacteristic(CTRL_UUID)
                    session.nonce = service?.getCharacteristic(NONCE_UUID)
                    if (session.info == null || session.token == null || session.status == null) {
                        failSession(session, "This device is not a supported Kiki band.")
                        return@runOnUiThread
                    }
                    session.pendingOperation = "connect_info"
                    if (!gatt.readCharacteristic(session.info)) {
                        failSession(session, "Android could not read the band's identity.")
                    }
                }
            }

            override fun onCharacteristicRead(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                handleCharacteristicRead(session, characteristic, characteristic.value ?: byteArrayOf(), status)
            }

            override fun onCharacteristicRead(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                value: ByteArray,
                status: Int
            ) {
                handleCharacteristicRead(session, characteristic, value, status)
            }

            override fun onCharacteristicWrite(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                status: Int
            ) {
                activity.runOnUiThread {
                    if (activeSession !== session || session.pendingOperation != "write") return@runOnUiThread
                    if (status == BluetoothGatt.GATT_SUCCESS) resolvePending(session, JSObject())
                    else rejectPending(session, "The band did not accept the Bluetooth command.")
                }
            }

            override fun onDescriptorWrite(
                gatt: BluetoothGatt,
                descriptor: BluetoothGattDescriptor,
                status: Int
            ) {
                activity.runOnUiThread {
                    if (activeSession !== session || session.pendingOperation != "notify_setup") return@runOnUiThread
                    if (status != BluetoothGatt.GATT_SUCCESS) {
                        failSession(session, "Android could not enable band status notifications.")
                        return@runOnUiThread
                    }
                    val result = JSObject()
                        .put("connectionId", session.id)
                        .put("name", session.name)
                        .put("info", session.rawInfo)
                        .put("pinSupported", session.ctrl != null && session.nonce != null)
                    resolvePending(session, result)
                }
            }

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic
            ) {
                publishStatus(session, characteristic.value ?: byteArrayOf())
            }

            override fun onCharacteristicChanged(
                gatt: BluetoothGatt,
                characteristic: BluetoothGattCharacteristic,
                value: ByteArray
            ) {
                publishStatus(session, value)
            }
        }

        try {
            session.gatt = if (Build.VERSION.SDK_INT >= 23) {
                found.device.connectGatt(context, false, callback, BluetoothDevice.TRANSPORT_LE)
            } else {
                found.device.connectGatt(context, false, callback)
            }
            if (session.gatt == null) failSession(session, "Android could not open the Bluetooth connection.")
        } catch (error: SecurityException) {
            failSession(session, "Android denied access to the Bluetooth connection.")
        }
    }

    private fun handleCharacteristicRead(
        session: BandSession,
        characteristic: BluetoothGattCharacteristic,
        value: ByteArray,
        status: Int
    ) {
        activity.runOnUiThread {
            if (activeSession !== session) return@runOnUiThread
            if (status != BluetoothGatt.GATT_SUCCESS) {
                if (session.pendingOperation == "connect_info") {
                    failSession(session, "Android could not read the band's identity.")
                } else {
                    rejectPending(session, "The band could not return the requested Bluetooth value.")
                }
                return@runOnUiThread
            }
            val text = value.toString(Charsets.UTF_8).trim()
            when (session.pendingOperation) {
                "connect_info" -> {
                    session.rawInfo = text
                    val gatt = session.gatt
                    val statusCharacteristic = session.status
                    if (gatt == null || statusCharacteristic == null) {
                        failSession(session, "The band's Bluetooth connection was lost.")
                        return@runOnUiThread
                    }
                    try {
                        if (!gatt.setCharacteristicNotification(statusCharacteristic, true)) {
                            failSession(session, "Android could not enable band status notifications.")
                            return@runOnUiThread
                        }
                        val descriptor = statusCharacteristic.getDescriptor(CLIENT_CONFIG_UUID)
                        if (descriptor == null) {
                            failSession(session, "The band does not support status notifications.")
                            return@runOnUiThread
                        }
                        session.pendingOperation = "notify_setup"
                        if (Build.VERSION.SDK_INT >= 33) {
                            val result = gatt.writeDescriptor(descriptor, BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE)
                            if (result != android.bluetooth.BluetoothStatusCodes.SUCCESS) {
                                failSession(session, "Android could not enable band status notifications.")
                            }
                        } else {
                            descriptor.value = BluetoothGattDescriptor.ENABLE_NOTIFICATION_VALUE
                            if (!gatt.writeDescriptor(descriptor)) {
                                failSession(session, "Android could not enable band status notifications.")
                            }
                        }
                    } catch (error: SecurityException) {
                        failSession(session, "Android denied access to the Bluetooth connection.")
                    }
                }
                "read" -> resolvePending(session, JSObject().put("value", text))
            }
        }
    }

    private fun publishStatus(session: BandSession, bytes: ByteArray) {
        if (activeSession !== session) return
        val value = bytes.toString(Charsets.UTF_8).trim()
        if (value.isNotEmpty()) {
            notifyListeners("bandStatus", JSObject().put("id", session.id).put("value", value))
        }
    }

    @PluginMethod
    fun readBandValue(call: PluginCall) {
        val session = requireSession(call) ?: return
        val characteristic = when (call.getString("characteristic")) {
            "info" -> session.info
            "nonce" -> session.nonce
            else -> null
        }
        if (characteristic == null) {
            call.reject("The band does not support that Bluetooth read.")
            return
        }
        val gatt = session.gatt
        if (gatt == null || !beginOperation(session, call, "read")) return
        try {
            if (!gatt.readCharacteristic(characteristic)) rejectPending(session, "Android could not read the requested value from the band.")
        } catch (error: SecurityException) {
            rejectPending(session, "Android denied access to the Bluetooth connection.")
        }
    }

    @PluginMethod
    fun writeBandValue(call: PluginCall) {
        val session = requireSession(call) ?: return
        val characteristic = when (call.getString("characteristic")) {
            "token" -> session.token
            "ctrl" -> session.ctrl
            else -> null
        }
        val value = call.getString("value")
        if (characteristic == null || value == null) {
            call.reject("The band does not support that Bluetooth write.")
            return
        }
        val gatt = session.gatt
        if (gatt == null || !beginOperation(session, call, "write")) return
        val bytes = value.toByteArray(Charsets.UTF_8)
        try {
            if (Build.VERSION.SDK_INT >= 33) {
                val result = gatt.writeCharacteristic(
                    characteristic,
                    bytes,
                    BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                )
                if (result != android.bluetooth.BluetoothStatusCodes.SUCCESS) {
                    rejectPending(session, "Android could not send the Bluetooth command to the band.")
                }
            } else {
                characteristic.writeType = BluetoothGattCharacteristic.WRITE_TYPE_DEFAULT
                characteristic.value = bytes
                if (!gatt.writeCharacteristic(characteristic)) {
                    rejectPending(session, "Android could not send the Bluetooth command to the band.")
                }
            }
        } catch (error: SecurityException) {
            rejectPending(session, "Android denied access to the Bluetooth connection.")
        }
    }

    @PluginMethod
    fun disconnectBand(call: PluginCall) {
        val session = activeSession
        if (session != null && session.id == call.getString("connectionId")) closeSession(session)
        call.resolve()
    }

    private fun requireSession(call: PluginCall): BandSession? {
        val session = activeSession
        if (session == null || session.id != call.getString("connectionId") || session.gatt == null) {
            call.reject("The band is no longer connected. Find it again to continue.")
            return null
        }
        return session
    }

    private fun beginOperation(session: BandSession, call: PluginCall, operation: String): Boolean {
        if (session.pendingCall != null) {
            call.reject("A Bluetooth request is already in progress. Wait a moment and try again.")
            return false
        }
        call.setKeepAlive(true)
        session.pendingCall = call
        session.pendingOperation = operation
        return true
    }

    private fun resolvePending(session: BandSession, result: JSObject) {
        val call = session.pendingCall ?: return
        session.pendingCall = null
        session.pendingOperation = null
        call.setKeepAlive(false)
        call.resolve(result)
    }

    private fun rejectPending(session: BandSession, message: String) {
        val call = session.pendingCall ?: return
        session.pendingCall = null
        session.pendingOperation = null
        call.setKeepAlive(false)
        call.reject(message)
    }

    private fun failSession(session: BandSession, message: String) {
        rejectPending(session, message)
        closeSession(session)
    }

    private fun rejectCall(call: PluginCall?, message: String) {
        if (call == null) return
        call.setKeepAlive(false)
        call.reject(message)
    }

    private fun closeSession(session: BandSession) {
        if (activeSession === session) activeSession = null
        rejectPending(session, "The band connection was closed.")
        try {
            session.gatt?.disconnect()
            session.gatt?.close()
        } catch (_: SecurityException) {
            session.gatt?.close()
        }
        session.gatt = null
    }

    private fun bluetoothAdapter(): BluetoothAdapter? =
        (context.getSystemService(android.content.Context.BLUETOOTH_SERVICE) as? BluetoothManager)?.adapter

    private fun stopScan() {
        scanTimeout?.let(handler::removeCallbacks)
        scanTimeout = null
        val callback = scanCallback
        val activeScanner = scanner
        if (callback != null && activeScanner != null) {
            try {
                activeScanner.stopScan(callback)
            } catch (_: SecurityException) {
                // The scan is already unusable after permission revocation.
            } catch (_: IllegalStateException) {
                // Bluetooth was turned off while the scan was active.
            }
        }
        scanCallback = null
        scanner = null
    }

    override fun handleOnDestroy() {
        stopScan()
        dismissScanDialog()
        scanCall?.let { rejectCall(it, "Bluetooth search was interrupted.") }
        scanCall = null
        activeSession?.let(::closeSession)
    }

    companion object {
        private const val SCAN_DURATION_MS = 10_000L
        private val SERVICE_UUID = UUID.fromString("7b1c0001-4e5a-4a6d-9c1b-8f3a2d5e6b00")
        private val INFO_UUID = UUID.fromString("7b1c0002-4e5a-4a6d-9c1b-8f3a2d5e6b00")
        private val TOKEN_UUID = UUID.fromString("7b1c0003-4e5a-4a6d-9c1b-8f3a2d5e6b00")
        private val STATUS_UUID = UUID.fromString("7b1c0004-4e5a-4a6d-9c1b-8f3a2d5e6b00")
        private val CTRL_UUID = UUID.fromString("7b1c0005-4e5a-4a6d-9c1b-8f3a2d5e6b00")
        private val NONCE_UUID = UUID.fromString("7b1c0006-4e5a-4a6d-9c1b-8f3a2d5e6b00")
        private val CLIENT_CONFIG_UUID = UUID.fromString("00002902-0000-1000-8000-00805f9b34fb")
    }
}
