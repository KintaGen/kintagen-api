// src/services/analysis.service.js
import { spawn } from 'child_process';

/**
 * A helper function to run external scripts as a promise.
 * @param {string} command The command to run (e.g., 'Rscript').
 * @param {string[]} args An array of arguments for the command.
 * @param {object} [options={}] Options for the child process (e.g., { cwd: '/path/to/dir' }).
 * @returns {Promise<string>} A promise that resolves with the script's stdout.
 */
export function runScript(commandString, args, options = {}) {
    return new Promise((resolve, reject) => {
        // 1. Split the command string from the .env file by spaces.
        const commandParts = commandString.trim().split(/\s+/);
        
        // 2. The first part is the actual program to execute (e.g., 'docker' or 'Rscript').
        const command = commandParts[0];
        
        // 3. The rest of the parts are the base arguments, which we combine with the script-specific args.
        const allArgs = [...commandParts.slice(1), ...args];
        
        console.log(`[SPAWN]: ${command} ${allArgs.join(' ')}`);

        const process = spawn(command, allArgs, options);
  
        let stdout = '';
        let stderr = '';
  
        process.stdout.on('data', (data) => {
            stdout += data.toString();
        });
  
        process.stderr.on('data', (data) => {
            stderr += data.toString();
        });
  
        process.on('close', (code) => {
            if (code !== 0) {
                const error = new Error(`Process ${command} exited with code ${code}`);
                error.stdout = stdout;
                error.stderr = stderr;
                return reject(error);
            }
            resolve(stdout);
        });
  
        process.on('error', (err) => {
            reject(err);
        });
    });
}