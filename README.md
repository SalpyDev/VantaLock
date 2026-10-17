# VantaLock 🔒

VantaLock is a free, completely open-source, local-first desktop application designed to protect sensitive files—such as contracts, credentials, and confidential documents—without relying on the cloud or external servers. It creates a Zero-Cloud Encrypted Vault directly on your local hardware.

## 🛡️ Security Architecture

To maintain absolute local security and trust, VantaLock implements the following cryptographic protocols:
- **Key Derivation:** Master keys are derived safely on-disk using **Argon2id**.
- **Encryption Standard:** Multi-file assets are locked via authenticated **AES-256-GCM** encryption.
- **Privacy Assurance:** Zero network telemetry. The core encryption engine runs strictly offline on your local host architecture.

## 🚀 Downloads & Installation

Pre-compiled production binaries can be downloaded directly from the official deployment site:
👉 **[vantalock.me](https://vantalock.me)**

*Note: The downloadable Windows `.exe` installer is currently unsigned. If you encounter a Windows Defender SmartScreen warning during installation, you can bypass it manually or choose to build the project directly from the source instructions below.*

## 🛠️ Local Development & Build Instructions

If you prefer to inspect the source code and compile the application manually to bypass unsigned executable warnings, follow these steps:

### Prerequisites
- Node.js (v18 or higher recommended)
- npm

### Installation
1. Clone the repository:
   ```bash
   git clone https://github.com
   ```
2. Navigate into the directory:
   ```bash
   cd VantaLock
   ```
3. Install the dependencies:
   ```bash
   npm install
   ```

### Running the App Locally
To launch the application in development mode:
```bash
npm start
```
