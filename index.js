let fs = require('fs')
let path = require('path')
let express = require('express')
let morgan = require('morgan')
let nodeify = require('bluebird-nodeify')
let mime = require('mime-types')
let rimraf = require('rimraf')
let mkdirp = require('mkdirp')
let bluebird = require('bluebird')
let archiver = require('archiver')
let argv = require('yargs').argv
let chokidar=require('chokidar')

require('songbird')
let jsonovertcp = require('json-over-tcp')

bluebird.longStackTraces()

console.log('File System path: ' + argv.dirname)
const NODE_ENV = process.env.NODE_ENV || 'development'
const PORT = process.env.PORT || 8000
const TCP_PORT = process.env.TCP_PORT || 8001
let clientSocketList = []
const ROOT_DIR = argv.dirname ? path.resolve(argv.dirname) : path.resolve(process.cwd())
const OPERATION_CREATE = 'create'
const OPERATION_UPDATE = 'update'
const OPERATION_DELETE = 'delete'

let app = express()
if (NODE_ENV === 'development') {
  app.use(morgan('dev'))
}



chokidar.watch(ROOT_DIR, {ignored: /[\/\\]\./}).on('all', async (event, path,stat,next) => {

let fileType = stat && stat.isDirectory()? 'dir' :'file'
let op= null
let contents=''






 if(event === 'add' || event == 'addDir') {
 	
 	op=OPERATION_CREATE

 	if(event=='addDir'){
 		fileType='dir'
 	}
 }
 if(event === 'unlink') op=OPERATION_DELETE

 if(event === 'change') op=OPERATION_UPDATE	
  
 for (let i = 0; i < clientSocketList.length; i++) { 

if (fileType === 'file' && op !== OPERATION_DELETE) {
console.log(path)
console.log(event)
console.log(fileType)
   
contents=await fs.promise.readFile(path,'utf-8')
     
   }

   if(event)

   try{
let data = {
     'action': op,
     'path': path,
     'contents': contents,
     'type': fileType,
     'updated': Date.now()
   }	

data = JSON.stringify(data)
   console.log('After the method...' + data)
   clientSocketList[i].write(data)

   }catch(e){
   	console.log(e.stack)
   }
}
next()
})

app.listen(PORT, ()=> console.log(`HTTP Server Listening @ http://127.0.0.1:${PORT}`))

function setFileAttributes(req, res, next){
  let filePath = path.resolve(path.join(ROOT_DIR, req.url))
  req.filePath = filePath
  if(req.filePath.indexOf(ROOT_DIR) !== 0){
    res.send(400, 'Invalid Request!')
    return
  }

  fs.promise.stat(filePath)
  .then(stat => req.stat = stat, () => req.stat = null)
  .nodeify(next)
}

function sendHeaders(req, res, next){
  nodeify(async ()=> {
    if(req.stat.isDirectory()){	
    	res.setHeader('message', 'it is directroy')
    	var headers=JSON.stringify(req.headers)
    	//console.log(headers)
    	if(req.get('Accept')==='application/x-gtar'){
    		res.setHeader('headerm','special header found')
  	let archive = archiver('zip')
    archive.pipe(res);
    archive.bulk([
        { expand: true, cwd: 'source', src: ['**'], dest: 'source'}
    ])
    archive.finalize()
  }
       let files = await fs.promise.readdir(req.filePath)
       res.body = JSON.stringify(files)
       res.setHeader('Content-Length', res.body.length)
       res.setHeader('Content-Type', 'application/json')
       return
    }

    res.setHeader('Content-Length', req.stat.size)
    let contentType = mime.contentType(path.extname(req.filePath))
    res.setHeader('Content-Type', contentType)
  }(), next)
}

function setDirDetails(req, res, next){
  let endsWithSlash = req.filePath.charAt(req.filePath.length - 1) === path.sep
  let hasExt = path.extname(req.filePath) !== ''
  req.isDir = endsWithSlash || !hasExt
  console.log('isDir: '+ req.isDir)
  req.dirPath = req.isDir ? req.filePath : path.dirname(req.filePath)
  console.log('Slash present? ' + req.filePath.charAt(req.filePath.length - 1))
  console.log('path.sep' + path.sep)
  console.log('endsWithSlash: ' + endsWithSlash)
  console.log('hasExt: ' + hasExt)
  console.log('req.filePath: ' + req.filePath)
  console.log('req.dirPath: ' + req.dirPath)
  next()
}

async function notifyClients(req, res, next){
  for (let i = 0; i < clientSocketList.length; i++) {
    // Read the contents of the file
    let contents = null
    let fileType = req.isDir ? 'dir' : 'file'
    console.log('Notify Clients: ' + req.operation)
    // Get the file contents if the operation is PUT/POST
    if (fileType === 'file' && req.operation !== OPERATION_DELETE) {
      await fs.promise.readFile(req.filePath, 'utf-8')
      .then((fileContent) => {
        contents = fileContent
        console.log('Contents: ' + contents)
      })
    }

    let data = {
      'action': req.operation,
      'path': req.filePath,
      'contents': contents,
      'type': fileType,
      'updated': Date.now()
    }
    req.data = data
    data = JSON.stringify(req.data)
    console.log('After the method...' + data)
    clientSocketList[i].write(data)
    res.end()
  }
  next()
}



app.get('*', setFileAttributes, sendHeaders, (req, res) => {
  if(res.body){
    res.json(res.body)
    return
  }
  fs.createReadStream(req.filePath).pipe(res)
})

app.head('*', setFileAttributes, sendHeaders, (req, res) => res.end())


app.delete('*', setFileAttributes, setDirDetails, (req, res, next) => {
  async () => {
    if(!req.stat){
      return res.send(400, 'File not found!!')
    }

  nodeify(async ()=> {
    if(req.stat.isDirectory()){
      await rimraf.promise(req.filePath)
    } else {
      await fs.promise.unlink(req.filePath)
    }
    console.log('Test 1 ')
    req.operation = OPERATION_DELETE
    }(), next)
   //res.end()
  }().catch(next)
}, notifyClients)

app.put('*', setFileAttributes, setDirDetails, (req, res, next) => {
  async ()=> {
    if (req.stat) return res.send(405, 'File Exists')
    await mkdirp.promise(req.dirPath)
    if (!req.isDir){
      fs.createWriteStream(req.filePath)
      await req.pipe(fs.createWriteStream(req.filePath))
    }
    req.operation = OPERATION_CREATE
    next()
    //res.end()
  }().catch(next)

}, notifyClients)

app.post('*', setFileAttributes, setDirDetails, (req, res, next) => {
  async ()=> {
    if (!req.stat) return res.send(405, 'File Doesnt Exist')
    if (req.isDir) return res.send(405, 'Path is a directory')

    req.operation = OPERATION_UPDATE
    await fs.promise.truncate(req.filePath, 0)
    nodeify(async ()=> {
      await req.pipe(fs.createWriteStream(req.filePath))
    }(), next)
    //res.end()
  }().catch(next)

}, notifyClients)

// Create TCP Server

let tcpServer = jsonovertcp.createServer(TCP_PORT).listen(TCP_PORT)
console.log(`TCP Server listening @ http://127.0.0.1:${TCP_PORT}`)

tcpServer.on('connection', (socket) => {
  socket.on('data', (data) => {
    console.log("TCP Connection from client. Client Id:  " + data.clientId + ' .Adding client to listeners')
    clientSocketList.push(socket)
  })
})