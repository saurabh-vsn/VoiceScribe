# VoiceScribe — Voice-Controlled Writing Machine

VoiceScribe is a high-performance, local-first web application designed to control a 2D CNC plotter using voice commands and text input. Built for the Dept. of Production Engineering at NIT Agartala, it bridges the gap between digital voice recognition and physical pen-on-paper output.

## 🚀 Features
- **Voice-to-GCode**: Real-time voice recognition using the Web Speech API.
- **Hardware Control**: Direct USB communication via Web Serial API (Chrome/Edge).
- **Vector Engine**: Custom implementation of Hershey single-stroke fonts for smooth writing.
- **Visual Feedback**: Live canvas preview and coordinate tracking.
- **Dev Suite**: Integrated G-Code console and system parameter monitoring.

## 🛠️ Hardware Requirements
- **Microcontroller**: Arduino Uno (running GRBL 1.1).
- **Motors**: NEMA 17 Stepper Motors (X/Y).
- **Pen Lift**: SG90 Micro Servo or Z-axis Stepper.
- **Drivers**: A4988 or DRV8825.
- **Architecture**: H-Bot / CoreXY or standard Cartesian.

## 💻 Software Stack
- **Frontend**: Vanilla HTML5, CSS3, JavaScript (ES6+).
- **APIs**: Web Serial, Web Speech, LocalStorage.
- **Fonts**: Hershey Simplex (Single-stroke vector fonts).

## 🚦 Quick Start
1. Connect your Arduino via USB.
2. Open `index.html` in a modern browser (Chrome or Edge).
3. Navigate to the **Control Panel**.
4. Select the correct **Baud Rate** (usually 115200) and click **Connect**.
5. Click the **Microphone** icon and say "Write Hello World" or "Draw Circle".

## 🔧 Parameters
You can fine-tune the following in the **Parameters** tab:
- **Feed Rate**: Writing speed in mm/min.
- **Servo Angles**: Calibration for Pen UP/DOWN positions.
- **Dwell Times**: Delays for mechanical pen movement.

---
*Developed at NIT Agartala · 2024*
