const { app, BrowserWindow, globalShortcut } = require('electron');
const path = require('path');
const screenshot = require('screenshot-desktop');
const fs = require('fs');
const { OpenAI } = require('openai');
const { execSync } = require('child_process');
const os = require('os');

let config;
try {
  const configPath = path.join(__dirname, 'config.json');
  const configData = fs.readFileSync(configPath, 'utf8');
  config = JSON.parse(configData);
  
  if (!config.apiKey) {
    throw new Error("API key is missing in config.json");
  }
  
  // Set default model if not specified
  if (!config.model) {
    config.model = "gpt-4o-mini";
    console.log("Model not specified in config, using default:", config.model);
  }
} catch (err) {
  console.error("Error reading config:", err);
  app.quit();
}
const openai = new OpenAI({ apiKey: config.apiKey });

let mainWindow;
let screenshots = [];
let multiPageMode = false;
let showWindow = true;
let stage = 0; // 0 = boot up stage, 1 = multi capture, 2 = AI Answered

function updateInstruction(instruction) {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('update-instruction', instruction);
  }
}

function hideInstruction() {
  if (mainWindow?.webContents) {
    mainWindow.webContents.send('hide-instruction');
  }
}

async function captureScreenshot() {
  try {
    hideInstruction();
    mainWindow.hide();
    await new Promise(res => setTimeout(res, 200));

    const timestamp = Date.now();
    const tempDir = os.tmpdir();
    const fileName = `screenshot_${timestamp}.png`;
    const imagePath = path.join(tempDir, fileName);
    await screenshot({ filename: imagePath });

    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    mainWindow.show();
    return base64Image;
  } catch (err) {
    mainWindow.show();
    if (mainWindow.webContents) {
      mainWindow.webContents.send('error', err.message);
    }
    throw err;
  }
}

async function captureActiveWindow() {
  try {
    hideInstruction();
    mainWindow.hide();
    await new Promise(res => setTimeout(res, 300)); // Give time for window to hide

    const timestamp = Date.now();
    const tempDir = os.tmpdir();
    const fileName = `screenshot_${timestamp}.png`;
    const imagePath = path.join(tempDir, fileName);

    // Use nircmd to capture the foreground (active) window
    execSync(`nircmd.exe savescreenshotwin "${imagePath}"`, { stdio: 'ignore' });

    // Read and convert to base64
    const imageBuffer = fs.readFileSync(imagePath);
    const base64Image = imageBuffer.toString('base64');

    mainWindow.show();
    return base64Image;
  } catch (err) {
    mainWindow.show();
    if (mainWindow.webContents) {
      mainWindow.webContents.send('error', err.message);
    }
    throw err;
  }
}


function showMainWindow() {
  mainWindow.show();
  if (stage == 2)
    mainWindow.webContents.send('show-app');
  else
    updateInstruction();
  showWindow = true;
}

function hideMainWindow() {
  mainWindow.webContents.send('hide-app');
  mainWindow.hide();
  showWindow = false;
}

async function processScreenshots() {
  try {
    // Build message with text + each screenshot
    const messages = [
      { type: "text", text: "Solve the coding problem(s) in the image(s). If it looks like an online IDE (e.g., Hackerrank), just comment the code. Otherwise, write a full response" }
    ];
    for (const img of screenshots) {
      messages.push({
        type: "image_url",
        image_url: { url: `data:image/png;base64,${img}` }
      });
    }

    // Make the request
    const response = await openai.chat.completions.create({
      model: config.model,
      messages: [
        {
          role: "system",
          content: [
            "You are a mid– to senior–level software engineer expert in competitive programming.",
            "You already know Amazon’s Top LeetCode Questions from this list:",
            "https://leetcode.com/problem-list/7p5x763/?sorting=W3sic29ydE9yZGVyIjoiREVTQ0VORElORyIsIm9yZGVyQnkiOiJGUkVRVUVOQ1kifV0=&page=1",
            "",
            "When I provide you a problem (by description, screenshot, or LeetCode ID):",
            "1. Restate the problem in your own words, provide questions and assumptions, and highlighting the core challenge and patterns it represents (don’t copy verbatim).",
            "2. Call out key insights and problem – type patterns (e.g., sliding window, DP, graph traversal) by matching (quoting) the problem description. i.e. \"Find the max\" would suggest....",
            "3. Provide two separate code blocks:",
            "   • First, a naive brute-force implementation (clearly labeled) with inline comments showing the core idea.",
            "   • Second, the optimal pattern-based solution (clearly labeled) with comments explaining why it’s preferred.",
            "4. Demonstrate or simulate code against sample cases.",
            "5. Conclude with time and space complexity analysis.",
            "",
            "Speak in first person, as if you’re thinking out loud in an interview room, phrased naturally for a listener encountering it fresh. Also, write all code in C#."
          ].join("\n")
        },
        { role: "user", content: messages }
      ],
      max_completion_tokens: 5000
    });
    

    // Send the text to the renderer
    mainWindow.webContents.send('analysis-result', response.choices[0].message.content);

    // // Create mock data for the response
    // const mockResponse = {
    //   choices: [
    //       {
    //           message: {
    //               content: "This is the mocked response from the AI."
    //           }
    //       }
    //   ]
    // };

    // // Simulate receiving the response
    // const response = mockResponse;

    // // Send the text to the renderer
    // mainWindow.webContents.send('analysis-result', response.choices[0].message.content);
    stage = 2;
  } catch (err) {
    console.error("Error in processScreenshots:", err);
    if (mainWindow.webContents) {
      mainWindow.webContents.send('error', err.message);
    }
  }
}

// Reset everything
function resetProcess() {
  screenshots = [];
  multiPageMode = false;
  mainWindow.webContents.send('clear-result');
  updateInstruction("Ctrl+Shift+S: Screenshot | Ctrl+Shift+A: Multi-mode | Ctrl+Shift+W: Hide Window | Ctrl+Shift+Q: Close");
  stage = 0;
}

function createWindow() {
  stage = 0;
  mainWindow = new BrowserWindow({
    width: 800,
    height: 600,
    webPreferences: {
      nodeIntegration: true,
      contextIsolation: false
    },
    frame: false,
    transparent: true,
    alwaysOnTop: true,
    paintWhenInitiallyHidden: true,
    contentProtection: true,
    type: 'toolbar',
  });

  mainWindow.loadFile('index.html');
  mainWindow.setContentProtection(true);
  mainWindow.setVisibleOnAllWorkspaces(true, { visibleOnFullScreen: true });
  mainWindow.setAlwaysOnTop(true, 'screen-saver', 1);

  // Ctrl+Shift+S => single or final screenshot
  globalShortcut.register('CommandOrControl+Shift+S', async () => {
    try {
      let img;
      try {
        img = await captureActiveWindow();
      } catch (err) {
        console.warn("captureActiveWindow failed, falling back to captureScreenshot:", err.message);
        img = await captureScreenshot();
      }
      screenshots.push(img);
      await processScreenshots();
    } catch (error) {
      console.error("Ctrl+Shift+S error:", error);
    }
  });

  // Ctrl+Shift+A => multi-page mode
  globalShortcut.register('CommandOrControl+Shift+A', async () => {
    try {
      if (!multiPageMode) {
        multiPageMode = true;
        updateInstruction("Multi-mode: Ctrl+Shift+A to add, Ctrl+Shift+S to finalize");
      }
      let img;
      try {
        img = await captureActiveWindow();
      } catch (err) {
        console.warn("captureActiveWindow failed, falling back to captureScreenshot:", err.message);
        img = await captureScreenshot();
      }
      screenshots.push(img);
      updateInstruction("Multi-mode: Ctrl+Shift+A to add, Ctrl+Shift+S to finalize");
      stage = 1;
    } catch (error) {
      console.error("Ctrl+Shift+A error:", error);
    }
  });

  // Ctrl+Shift+R => reset
  globalShortcut.register('CommandOrControl+Shift+R', () => {
    resetProcess();
  });

  // Ctrl+Shift+W => Hide app
  globalShortcut.register('CommandOrControl+Shift+W', () => {
    if (showWindow)
    {
      hideMainWindow();
    }
    else
    {
      showMainWindow();
    }
  });
     
  // Ctrl+Shift+Q => Quit the application
globalShortcut.register('CommandOrControl+Shift+Q', () => {
  console.log("Quitting application...");
  app.quit();
  
});
}

app.whenReady().then(createWindow);

app.on('window-all-closed', () => {
  globalShortcut.unregisterAll();
  if (process.platform !== 'darwin') {
    app.quit();
  }
});

app.on('activate', () => {
  if (BrowserWindow.getAllWindows().length === 0) {
    createWindow();
  }
});
