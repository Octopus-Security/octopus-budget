FROM node:18
 
# Set the working directory
WORKDIR /usr/src/app
 
# Copy package files and install dependencies as root
COPY package*.json ./
RUN npm install
 
# Copy the rest of the application source code
COPY . .

# Change ownership of the entire application directory to the node user
RUN chown -R node:node /usr/src/app
 
# Switch to the non-root user for security
USER node
 
# Expose the port the app runs on
EXPOSE 3000
 
# Start the app
CMD [ "node", "index.js" ]