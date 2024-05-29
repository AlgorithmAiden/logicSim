function createReactiveVariable(name, initialValue, onChangeCallback) {
    let _value = initialValue
    Object.defineProperty(window, name, {
        get() { return _value },
        set(newValue) {
            if (_value != newValue) {
                const oldValue = _value
                _value = newValue
                onChangeCallback(oldValue, newValue)
            }
        },
        configurable: false
    })
}

const canvas = document.getElementById('canvas')
const ctx = canvas.getContext('2d')

function addInput(input) {
    const wrapper = document.createElement('div')
    wrapper.classList.add('input')

    function generateInsides() {
        wrapper.innerHTML = ''

        if (input.title != undefined) {
            const titleElement = document.createElement('div')
            titleElement.classList.add('input_title')
            titleElement.textContent = input.title
            wrapper.appendChild(titleElement)
        }

        const rowWrapper = document.createElement('div')
        rowWrapper.classList.add('input_rowWrapper')

        if (input.rows != undefined) {
            input.rows.forEach(row => {
                const rowElement = document.createElement('div')
                rowElement.classList.add('input_row')

                if (row.title != undefined) {
                    const titleElement = document.createElement('div')
                    titleElement.classList.add('input_row_title')
                    titleElement.textContent = row.title
                    rowElement.appendChild(titleElement)
                }

                const itemWrapper = document.createElement('div')
                itemWrapper.classList.add('input_row_itemWrapper')
                rowElement.appendChild(itemWrapper)

                row.items.forEach((item, index) => {
                    let itemElement
                    if (item.type == 'button') {
                        itemElement = document.createElement('button')
                        itemElement.classList.add('input_row_item_button')
                        itemElement.innerText = item.title

                        if (item.regenerate)
                            itemElement.addEventListener('click', () => {
                                item.func(wrapper, itemWrapper, index, input)
                                generateInsides()
                            })
                        else
                            itemElement.addEventListener('click', () => item.func(wrapper, itemWrapper, index))
                    }
                    else if (item.type == 'numberInput') {
                        itemElement = document.createElement('textarea')
                        itemElement.classList.add('input_row_item_numberInput')
                        itemElement.value = item.default
                        itemElement.rows = 1
                        itemElement.cols = 5

                        let lastValue = item.default
                        itemElement.addEventListener('change', () => {
                            if (isNaN(Number(itemElement.value))) itemElement.value = lastValue
                            if (item.round) itemElement.value = Math.round(itemElement.value)
                            itemElement.value = Math.max(item.min ?? -Infinity, Math.min(item.max ?? Infinity, itemElement.value))
                            if (itemElement.value != lastValue) item.func(wrapper, itemWrapper, index, Number(itemElement.value))
                            lastValue = itemElement.value
                        })

                    }
                    itemElement.classList.add('input_row_item')
                    if (index == 0) itemElement.classList.add('input_row_item_left')
                    if (index == row.items.length - 1) itemElement.classList.add('input_row_item_right')
                    itemWrapper.appendChild(itemElement)
                })

                rowWrapper.appendChild(rowElement)
            })
        }

        if (input.dropdown) {
            const dropdown = document.createElement('div')
            dropdown.classList.add('input_dropdown')
            dropdown.appendChild(rowWrapper)
            wrapper.appendChild(dropdown)
        } else wrapper.appendChild(rowWrapper)
    }

    if (input.dropdown && input.func != undefined) {
        input.func(input)

        let isOpen = false
        wrapper.addEventListener('mouseenter', () => {
            if (!isOpen) {
                input.func(input)
                generateInsides()
                isOpen = true
            }
        })
        wrapper.addEventListener('mouseleave', () => isOpen = false)
    }

    generateInsides()

    document.getElementById('inputs').appendChild(wrapper)

    return wrapper
}

let currentCircuit = {
    wires: [],
    components: []
}

if (localStorage.getItem('loadFromSave') == 'true') {
    currentCircuit = JSON.parse(localStorage.getItem('savedCircuit'))
    localStorage.setItem('loadFromSave', false)
}

let circuitWidth = Math.ceil(Math.max(3, ...(currentCircuit.wires.map(wire => wire.map(point => point.x + 1)).flat()), ...currentCircuit.components.map(component => component.x + 1)))
let circuitHeight = Math.ceil(Math.max(3, ...(currentCircuit.wires.map(wire => wire.map(point => point.y + 1)).flat()), ...currentCircuit.components.map(component => component.y + 1)))
let closestPoint = { x: 0, y: 0 }
let showGrid = true

let autoSave = localStorage.getItem('autoSave') == 'true'

let componentToPlace

let closestWireConnection
let firstWireConnection
let wireGridDensity = 1
let grabbedPoint
let showWireGrid = false

let IOToPlace

let showingSim

let unit, charWidth

function getRenderPointOfPoint(point, scale = 1) {
    if (point.type == 'input')
        return { x: (point.x + (point.index + 1) * (1 / (point.numberOfConnections + 1))) * scale, y: (point.y + 1) * scale }
    if (point.type == 'output')
        return { x: (point.x + .5) * scale, y: point.y * scale }
    return { x: point.x * scale, y: point.y * scale }
}

function renderWire(wire, color) {
    ctx.fillStyle = ctx.strokeStyle = color
    ctx.lineJoin = 'round'
    ctx.lineWidth = unit / 20
    const path = wire.map(point => getRenderPointOfPoint(point, unit))
    path.forEach(point => {
        ctx.beginPath()
        ctx.arc(point.x, point.y, ctx.lineWidth, 0, Math.PI * 2)
        ctx.fill()
    })
    ctx.beginPath()
    path.forEach(point => ctx.lineTo(point.x, point.y))
    ctx.stroke()
}

function getCrossingWires(targetPoint) {
    const out = []
    for (const wire of currentCircuit.wires) {
        for (let index = 0; index < wire.length - 1; index++) {
            const pointA = getRenderPointOfPoint(wire[index])
            const pointB = getRenderPointOfPoint(wire[index + 1])
            if ((pointA.x == pointB.x && pointA.x == targetPoint.x && Math.max(pointA.y, pointB.y) >= targetPoint.y && Math.min(pointA.y, pointB.y) <= targetPoint.y) || (pointA.y == pointB.y && pointA.y == targetPoint.y && Math.max(pointA.x, pointB.x) >= targetPoint.x && Math.min(pointA.x, pointB.x) <= targetPoint.x)) {
                const distanceA = Math.abs(pointA.x - targetPoint.x) + Math.abs(pointA.y - targetPoint.y)
                const distanceB = Math.abs(pointB.x - targetPoint.x) + Math.abs(pointB.y - targetPoint.y)
                if (distanceA < distanceB) out.push({ closePoint: pointA, farPoint: pointB, wire })
                else out.push({ closePoint: pointB, farPoint: pointA, wire })
            }
        }
    }
    return out
}

createReactiveVariable('mode', 'blank', modeChange)

let renderDelay = 250

function render(isLive, solvedBits, inputs) {
    isLive = isLive === true //otherwise it gets send the time for some reason?

    if (isLive) {
        this.solvedBits = solvedBits
        this.inputs = inputs
    } else if (showingSim) {
        solvedBits = this.solvedBits
        inputs = this.inputs
    }

    //size the canvas
    canvas.width = canvas.height = 0

    const wrapperStyles = window.getComputedStyle(document.getElementById('canvasWrapper'))

    unit = Math.min(parseFloat(wrapperStyles.width) / circuitWidth, parseFloat(wrapperStyles.height) / circuitHeight)
    canvas.width = unit * circuitWidth
    canvas.height = unit * circuitHeight

    ctx.font = `${unit}px Fira Code`
    charWidth = ctx.measureText('0').width / unit

    //background layer
    ctx.fillStyle = colorKey.background
    ctx.fillRect(0, 0, unit * circuitWidth, unit * circuitHeight)

    if (showGrid) {
        ctx.fillStyle = colorKey.background_bright
        for (let x = 0; x < circuitWidth; x++)
            for (let y = 0; y < circuitHeight; y++)
                if ((x + y) % 2)
                    ctx.fillRect(x * unit, y * unit, unit, unit)
    }

    //main layer
    if (showingSim)
        currentCircuit.wires.forEach(wire => renderWire(wire, colorKey[{ 'U': 'wire', '0': 'wire_off', '1': 'wire_on' }[solvedBits[currentCircuit.components.map((component, index) => ({ x: component.x, y: component.y, index })).filter(component => component.x == wire[0].x && component.y == wire[0].y)[0].index]]]))
    else
        currentCircuit.wires.forEach(wire => renderWire(wire, colorKey.wire))

    ctx.textBaseline = 'middle'
    ctx.textAlign = 'center'

    currentCircuit.components.forEach(component => {
        ctx.fillStyle = colorKey.component
        ctx.fillRect(component.x * unit, component.y * unit, unit, unit)
        ctx.font = `${unit / charWidth / String(component.type).length * .75}px Fira Code`
        ctx.fillStyle = colorKey.component_text
        ctx.fillText(component.type.toUpperCase(), (component.x + .5) * unit, (component.y + .5) * unit)
        ctx.fillStyle = colorKey.component_connection
        if (component.type == 'input') {
            const x = component.x + .5
            const y = component.y
            const lineSize = 1 / 8
            ctx.beginPath()
            ctx.lineTo(x * unit, y * unit)
            ctx.lineTo((x + lineSize) * unit, (y + lineSize) * unit)
            ctx.lineTo((x - lineSize) * unit, (y + lineSize) * unit)
            ctx.fill()
        } else if (component.type == 'output') {
            const x = component.x + .5
            const y = component.y + 1
            const lineSize = 1 / 8
            ctx.beginPath()
            ctx.lineTo(x * unit, (y - lineSize) * unit)
            ctx.lineTo((x + lineSize) * unit, y * unit)
            ctx.lineTo((x - lineSize) * unit, y * unit)
            ctx.fill()
        } else {
            const numberOfInputs = components[component.type].numberOfInputs
            let lineSize = 1 / numberOfInputs / 8
            let y = component.y + 1
            for (let index = 0; index < numberOfInputs; index++) {
                const x = component.x + (index + 1) * (1 / (numberOfInputs + 1))
                ctx.beginPath()
                ctx.lineTo(x * unit, (y - lineSize) * unit)
                ctx.lineTo((x + lineSize) * unit, y * unit)
                ctx.lineTo((x - lineSize) * unit, y * unit)
                ctx.fill()
            }
            const x = component.x + .5
            y = component.y
            lineSize = 1 / 8
            ctx.beginPath()
            ctx.lineTo(x * unit, y * unit)
            ctx.lineTo((x + lineSize) * unit, (y + lineSize) * unit)
            ctx.lineTo((x - lineSize) * unit, (y + lineSize) * unit)
            ctx.fill()
        }
    })

    if (mode == 'addingWire' && firstWireConnection != undefined) {
        ctx.fillStyle = colorKey.component_connection_connect
        ctx.beginPath()
        if (firstWireConnection.type == 'output') {
            const lineSize = 1 / 8
            ctx.lineTo((firstWireConnection.x + .5) * unit, firstWireConnection.y * unit)
            ctx.lineTo(((firstWireConnection.x + .5) + lineSize) * unit, (firstWireConnection.y + lineSize) * unit)
            ctx.lineTo(((firstWireConnection.x + .5) - lineSize) * unit, (firstWireConnection.y + lineSize) * unit)
        } else {
            const x = firstWireConnection.x + (firstWireConnection.index + 1) * (1 / (firstWireConnection.numberOfConnections + 1))
            const lineSize = 1 / firstWireConnection.numberOfConnections / 8
            ctx.lineTo(x * unit, ((firstWireConnection.y + 1) - lineSize) * unit)
            ctx.lineTo((x + lineSize) * unit, (firstWireConnection.y + 1) * unit)
            ctx.lineTo((x - lineSize) * unit, (firstWireConnection.y + 1) * unit)
        }
        ctx.fill()
    }

    //overlay layer
    if (showWireGrid) {
        ctx.fillStyle = colorKey.wire_grid_point
        for (let x = 0; x < circuitWidth * wireGridDensity; x++)
            for (let y = 0; y < circuitHeight * wireGridDensity; y++) {
                ctx.beginPath()
                ctx.arc((Math.floor(x / wireGridDensity) + (x % wireGridDensity + 1) * (1 / (wireGridDensity + 1))) * unit, (Math.floor(y / wireGridDensity) + (y % wireGridDensity + 1) * (1 / (wireGridDensity + 1))) * unit, unit / wireGridDensity / 8, 0, Math.PI * 2)
                ctx.fill()
            }
    }

    if (mode == 'placingComponent' && !currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y)) {
        ctx.fillStyle = colorKey.component_preview
        ctx.fillRect(closestPoint.x * unit, closestPoint.y * unit, unit, unit)
        ctx.font = `${unit / charWidth / String(componentToPlace).length * .75}px Fira Code`
        ctx.fillStyle = colorKey.component_text_preview
        ctx.fillText(componentToPlace.toUpperCase(), (closestPoint.x + .5) * unit, (closestPoint.y + .5) * unit)
    }

    else if (mode == 'removingComponent' && currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y)) {
        ctx.fillStyle = colorKey.component_remove
        ctx.fillRect(closestPoint.x * unit, closestPoint.y * unit, unit, unit)
    }

    else if (mode == 'addingWire' && closestWireConnection != undefined) {
        ctx.fillStyle = colorKey.component_connection_connect_preview
        ctx.beginPath()
        if (closestWireConnection.type == 'output') {
            const lineSize = 1 / 8
            ctx.lineTo((closestWireConnection.x + .5) * unit, closestWireConnection.y * unit)
            ctx.lineTo(((closestWireConnection.x + .5) + lineSize) * unit, (closestWireConnection.y + lineSize) * unit)
            ctx.lineTo(((closestWireConnection.x + .5) - lineSize) * unit, (closestWireConnection.y + lineSize) * unit)
        } else {
            const x = closestWireConnection.x + (closestWireConnection.index + 1) * (1 / (closestWireConnection.numberOfConnections + 1))
            const lineSize = 1 / closestWireConnection.numberOfConnections / 8
            ctx.lineTo(x * unit, ((closestWireConnection.y + 1) - lineSize) * unit)
            ctx.lineTo((x + lineSize) * unit, (closestWireConnection.y + 1) * unit)
            ctx.lineTo((x - lineSize) * unit, (closestWireConnection.y + 1) * unit)
        }
        ctx.fill()
    }

    else if (mode == 'routingWire') {

        if (grabbedPoint == undefined) {
            const crossingWires = getCrossingWires({ x: closestPoint.subX, y: closestPoint.subY })
            if (crossingWires.length > 0) {
                const wire = crossingWires[0].wire
                renderWire(wire, colorKey.wire_route_preview)
                ctx.fillStyle = colorKey.wire_route_point_preview
                ctx.beginPath()
                ctx.arc(closestPoint.subX * unit, closestPoint.subY * unit, unit / 20, 0, Math.PI * 2)
                ctx.fill()
            }
        } else {
            for (const wire of currentCircuit.wires)
                if (wire.includes(grabbedPoint))
                    renderWire(wire, colorKey.wire_route)
            ctx.fillStyle = colorKey.wire_route_point
            ctx.beginPath()
            ctx.arc(grabbedPoint.x * unit, grabbedPoint.y * unit, unit / 20, 0, Math.PI * 2)
            ctx.fill()
        }
    }

    else if (mode == 'removingWire') {
        ctx.lineJoin = 'round'
        ctx.lineWidth = unit / 20
        for (const wire of currentCircuit.wires) {
            if (wire.some(point => point.x == closestPoint.subX && point.y == closestPoint.subY)) {
                ctx.strokeStyle = colorKey.wire_remove
                ctx.fillStyle = ctx.strokeStyle
                const path = []
                wire.forEach(point => {
                    if (point.type == undefined)
                        path.push({ x: point.x * unit, y: point.y * unit })
                    else if (point.type == 'output')
                        path.push({ x: (point.x + .5) * unit, y: point.y * unit })
                    else {
                        path.push({ x: (point.x + (point.index + 1) * (1 / (point.numberOfConnections + 1))) * unit, y: (point.y + 1) * unit })
                    }

                })
                path.forEach(point => {
                    ctx.beginPath()
                    ctx.arc(point.x, point.y, ctx.lineWidth, 0, Math.PI * 2)
                    ctx.fill()
                })
                ctx.beginPath()
                path.forEach(point => ctx.lineTo(point.x, point.y))
                ctx.stroke()
                break
            }
        }
    }

    else if (mode == 'placingIO' && !currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y)) {
        ctx.fillStyle = colorKey.component_preview
        ctx.fillRect(closestPoint.x * unit, closestPoint.y * unit, unit, unit)
        ctx.font = `${unit / charWidth / String(IOToPlace).length * .75}px Fira Code`
        ctx.fillStyle = colorKey.component_text_preview
        ctx.fillText(IOToPlace.toUpperCase(), (closestPoint.x + .5) * unit, (closestPoint.y + .5) * unit)
    }

    requestAnimationFrame(render)
}

const mouse = { x: 0, y: 0 }

const startTime = Date.now()

const components = {
    nand: { numberOfInputs: 2 }
}

function createComponent(name, partComponents) {
    components[name] = { partComponents }
    const numberOfInputs = Math.max(...partComponents.map(component => component.inputs).flat().map(input => input * -1))
    components[name].numberOfInputs = numberOfInputs
}

createComponent('not', [
    { type: 'nand', inputs: [-1, -1], output: true }
])
createComponent('and', [
    { type: 'not', inputs: [1], output: true },
    { type: 'nand', inputs: [-1, -2] }
])
createComponent('or', [
    { type: 'nand', inputs: [1, 2], output: true },
    { type: 'not', inputs: [-1] },
    { type: 'not', inputs: [-2] },
])
createComponent('xor', [
    { type: 'and', inputs: [1, 2], output: true },
    { type: 'nand', inputs: [-1, -2] },
    { type: 'or', inputs: [-1, -2] }
])

const showModeElement = addInput({
    title: 'Current mode',
    rows: [
        {
            title: 'Blank',
            items: [
                {
                    type: 'button',
                    title: 'reset',
                    func(wrapper, row) {
                        mode = 'blank'
                        row.parentNode.children[0].innerText = 'Blank'
                    }
                }
            ]
        }
    ]
})

addInput({
    title: 'Circuit',
    rows: [
        {
            items: [
                {
                    type: 'button',
                    title: 'Save',
                    func() {
                        localStorage.setItem('savedCircuit', JSON.stringify(currentCircuit))
                    }
                },
                {
                    type: 'button',
                    title: 'Reset',
                    func() {
                        location.reload()
                    }
                },
                {
                    type: 'button',
                    title: 'Load',
                    func() {
                        if (localStorage.getItem('savedCircuit') == undefined)
                            alert('No circuit saved')
                        else {
                            localStorage.setItem('loadFromSave', true)
                            location.reload()
                        }
                    }
                }
            ]
        },
        {
            title: 'Auto save',
            items: [
                {
                    type: 'button',
                    title: autoSave,
                    func(wrapper, row, index) {
                        autoSave = !autoSave
                        localStorage.setItem('autoSave', autoSave)
                        row.children[index].innerText = autoSave
                    }
                }
            ]
        },
        {
            items: [
                {
                    type: 'button',
                    title: 'Log circuit',
                    func() {
                        console.log(JSON.parse(JSON.stringify(currentCircuit)))
                    }
                }
            ]
        }
    ]
}) //save / load

addInput({
    title: 'Circuit size',
    rows: [
        {
            title: 'Width',
            items: [
                {
                    type: 'button',
                    title: '/2',
                    func(wrapper, row) {
                        row.children[2].value /= 2
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'button',
                    title: '-1',
                    func(wrapper, row) {
                        row.children[2].value--
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'numberInput',
                    round: true,
                    default: circuitWidth,
                    min: 1,
                    func(wrapper, row, index, value) {
                        circuitWidth = value
                    }
                },
                {
                    type: 'button',
                    title: '+1',
                    func(wrapper, row) {
                        row.children[2].value++
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'button',
                    title: '*2',
                    func(wrapper, row) {
                        row.children[2].value *= 2
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                }
            ]
        },
        {
            title: 'Height',
            items: [
                {
                    type: 'button',
                    title: '/2',
                    func(wrapper, row) {
                        row.children[2].value /= 2
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'button',
                    title: '-1',
                    func(wrapper, row) {
                        row.children[2].value--
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'numberInput',
                    round: true,
                    default: circuitHeight,
                    min: 1,
                    func(wrapper, row, index, value) {
                        circuitHeight = value
                    }
                },
                {
                    type: 'button',
                    title: '+1',
                    func(wrapper, row) {
                        row.children[2].value++
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'button',
                    title: '*2',
                    func(wrapper, row) {
                        row.children[2].value *= 2
                        row.children[2].dispatchEvent(new Event('change'))
                    }
                }
            ]
        },
        {
            title: 'Show grid',
            items: [{
                type: 'button',
                title: showGrid,
                func(wrapper, row, index) {
                    showGrid = !showGrid
                    row.children[index].innerText = showGrid
                }
            }]
        }
    ]
}) //circuit size

addInput({
    title: 'Simulation',
    rows: [
        {
            title: mode == 'running' ? 'Running' : 'Paused',
            items: [
                {
                    type: 'button', title: 'pause', func(wrapper, row) {
                        if (mode == 'running')
                            mode = 'blank'
                        row.parentNode.children[0].innerText = 'Paused'
                    }
                },
                {
                    type: 'button', title: 'play', func(wrapper, row) {
                        mode = 'running'
                        showingSim = true
                        row.parentNode.children[0].innerText = 'Running'
                        solveAllCircuitInputs(currentCircuit, 3, true)
                    }
                }
            ]
        },
        {
            title: 'Delay (ms)',
            items: [1000, 500, 250, 100, 0].map(time => ({
                type: 'button',
                title: time,
                func() {
                    renderDelay = time
                }
            }))
        }
    ]
}) //sim speed

addInput({
    title: 'Wires',
    rows: [
        {
            items: [
                {
                    type: 'button',
                    title: 'Add',
                    func() {
                        mode = 'addingWire'
                    }
                },
                {
                    type: 'button',
                    title: 'Route',
                    func() {
                        mode = 'routingWire'
                    }
                },
                {
                    type: 'button',
                    title: 'Remove',
                    func() {
                        mode = 'removingWire'
                    }
                }
            ]
        },
        {
            title: 'Wire grid density',
            items: [
                {
                    type: 'button', title: '-2', func(wrapper, row) {
                        row.children[1].value = Number(row.children[1].value) - 2
                        row.children[1].dispatchEvent(new Event('change'))
                    }
                },
                {
                    type: 'numberInput', default: wireGridDensity, func(wrapper, row, index, value) {
                        wireGridDensity = value
                    }, min: 1, max: 9, round: true
                },
                {
                    type: 'button', title: '+2', func(wrapper, row) {
                        row.children[1].value = Number(row.children[1].value) + 2
                        row.children[1].dispatchEvent(new Event('change'))
                    }
                }
            ]
        },
        {
            title: 'Show wire grid',
            items: [{
                type: 'button',
                title: showWireGrid,
                func(wrapper, row, index) {
                    showWireGrid = !showWireGrid
                    row.children[index].innerText = showWireGrid
                }
            }]
        }
    ]
}) //wires

addInput({
    title: 'Components',
    rows: [
        {
            items: [
                {
                    type: 'button',
                    title: 'Add input',
                    func() {
                        IOToPlace = 'input'
                        mode = 'placingIO'
                    }
                },
                {
                    type: 'button',
                    title: 'Add output',
                    func() {
                        IOToPlace = 'output'
                        mode = 'placingIO'
                    }
                }
            ]
        },
        {
            items: [
                {
                    type: 'button',
                    title: 'Add regular',
                    regenerate: true,
                    func(wrapper, row, index, input) {
                        if (input.clickedByChild)
                            input.clickedByChild = false
                        else if (row.parentNode.parentNode.children.length == 2) {
                            const keys = Object.keys(components)
                            const start = Date.now()
                            while (keys.length > 0) {
                                if (Date.now() - start >= 10) throw new Error('Infinite loop')
                                let rowKeys = []
                                while (keys.length > 0 && rowKeys.join('  ').length < 29) {
                                    if (Date.now() - start >= 10) throw new Error('Infinite loop')
                                    if (rowKeys.length > 0 && [...rowKeys, keys[0]].join(' ').length > 29) break
                                    rowKeys.push(...keys.splice(0, 1))
                                }
                                input.rows.push({
                                    items: rowKeys.map(key => ({
                                        type: 'button', title: key, func() {
                                            mode = 'placingComponent'
                                            componentToPlace = key
                                            input.rows.splice(2)
                                            input.clickedByChild = true
                                            row.children[index].dispatchEvent(new Event('click'))
                                        }
                                    }))
                                })
                            }
                        } else
                            input.rows.splice(2)
                    }
                },
                {
                    type: 'button',
                    title: 'Remove component',
                    func() {
                        mode = 'removingComponent'
                        componentToPlace = undefined
                    }
                }
            ]
        }
    ]
}) //components

const solvedStates = {
    'nand-U-U': 'U',
    'nand-U-0': '1',
    'nand-U-1': 'U',
    'nand-0-U': '1',
    'nand-0-0': '1',
    'nand-0-1': '1',
    'nand-1-U': 'U',
    'nand-1-0': '1',
    'nand-1-1': '0'
}

async function solveCircuit(circuit, inputs, doRender) {
    if (circuit == undefined) throw new Error('unknown circuit')
    const solvedBits = new Array(circuit.components.length).fill('U')

    let nextInputIndex = 0
    for (const index in circuit.components)
        if (circuit.components[index].type == 'input') {
            solvedBits[index] = inputs[nextInputIndex]
            for (const component of circuit.components)
                if (component.type != 'input')
                    for (const inputIndex in component.inputs)
                        if (component.inputs[inputIndex] == index)
                            component.inputs[inputIndex] = nextInputIndex
            nextInputIndex++
        }

    if (doRender) {
        render(true, solvedBits)
        await new Promise(r => setTimeout(r, renderDelay))
    }

    let output = 'U' //if all components output U then this will be the return value

    while (true) {
        let hasChanged = false
        for (let componentIndex = 0; componentIndex < circuit.components.length; componentIndex++) {
            const component = circuit.components[componentIndex]
            if (component.type == 'input' || component.type == 'output') continue
            const oldValue = solvedBits[componentIndex]
            const rawInputs = component.inputs.map(input => {
                if (input < 0) return inputs[Math.abs(input + 1)]
                return solvedBits[input]
            }).slice(0, component.numberOfInputs)
            const key = `${component.type}-${rawInputs.join('-')}`
            if (solvedStates[key] == undefined) {
                solvedStates[key] = await solveCircuit(components[component.type], rawInputs)
            }
            solvedBits[componentIndex] = solvedStates[key]
            if (oldValue != solvedBits[componentIndex]) {
                hasChanged = true
                if (component.output)
                    output = solvedBits[componentIndex]
                if (doRender) {
                    render(true, solvedBits)
                    await new Promise(r => setTimeout(r, renderDelay))
                }
            }
        }
        if (!hasChanged) return output
    }
}

async function solveAllCircuitInputs(circuit, numberOfInputs, doRender) {
    let solutions = {}
    for (let index = 0; index < 3 ** numberOfInputs; index++) {
        const inputs = new Array(numberOfInputs).fill(0).map((v, inputIndex) => ['U', '0', '1'][Math.floor(index / (3 ** inputIndex)) % 3])
        solutions[inputs.join('-')] = await solveCircuit(circuit, inputs, doRender)
        await new Promise(r => document.addEventListener('keypress', r))
    }
    return solutions
}

canvas.addEventListener('mousemove', event => {
    const rect = canvas.getBoundingClientRect()
    mouse.x = event.clientX - rect.left
    mouse.y = event.clientY - rect.top

    closestPoint.x = Math.min(circuitWidth - 1, Math.max(0, Math.floor(mouse.x / unit)))
    closestPoint.y = Math.min(circuitHeight - 1, Math.max(0, Math.floor(mouse.y / unit)))

    closestWireConnection = undefined
    if (mode == 'addingWire' && currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y)) {
        const componentType = currentCircuit.components.filter(component => component.x == closestPoint.x && component.y == closestPoint.y)[0].type
        if (componentType == 'input') {
            closestWireConnection = { type: 'output', index: 0, component: componentType, x: closestPoint.x, y: closestPoint.y, numberOfConnections: 1 }
        } else if (componentType == 'output') {
            closestWireConnection = { type: 'input', index: 0, component: componentType, x: closestPoint.x, y: closestPoint.y, numberOfConnections: 1 }
        } else {
            const numberOfInputs = components[componentType].numberOfInputs
            const connection = [{ type: 'output', x: closestPoint.x + .5, y: closestPoint.y }, ...(new Array(numberOfInputs).fill(0).map((v, index) => ({ type: 'input', index, x: closestPoint.x + (index + 1) * (1 / (numberOfInputs + 1)), y: closestPoint.y + 1 })))].map(p => ({ ...p, distance: Math.sqrt((p.x - mouse.x / unit) ** 2 + (p.y - mouse.y / unit) ** 2) })).sort((a, b) => a.distance - b.distance)[0]
            closestWireConnection = { type: connection.type, index: connection.index, component: componentType, x: closestPoint.x, y: closestPoint.y, numberOfConnections: connection.type == 'output' ? 1 : numberOfInputs }
        }
    }

    //sub x / y are snapped to wire grid points instead of regular grid points
    const WGDPlus1 = wireGridDensity + 1
    const unitByWGDPlus1By2 = unit / WGDPlus1 / 2
    closestPoint.subX = Number((Math.floor((mouse.x + unitByWGDPlus1By2) / unit * WGDPlus1)) / WGDPlus1)
    closestPoint.subY = Number((Math.floor((mouse.y + unitByWGDPlus1By2) / unit * WGDPlus1)) / WGDPlus1)
    if (closestPoint.subX % 1 == 0)
        if (Number(((mouse.x + unitByWGDPlus1By2) / unit * WGDPlus1) / WGDPlus1) % 1 - 1 / WGDPlus1 / 2 < 0)
            closestPoint.subX = Number((Math.floor((mouse.x + unitByWGDPlus1By2) / unit * WGDPlus1 - 1 / WGDPlus1 * 2)) / WGDPlus1)
        else
            closestPoint.subX = Number((Math.floor((mouse.x + unitByWGDPlus1By2) / unit * WGDPlus1 + 1 / WGDPlus1 * 2)) / WGDPlus1)
    if (closestPoint.subY % 1 == 0)
        if (Number(((mouse.y + unitByWGDPlus1By2) / unit * WGDPlus1) / WGDPlus1) % 1 - 1 / WGDPlus1 / 2 < 0)
            closestPoint.subY = Number((Math.floor((mouse.y + unitByWGDPlus1By2) / unit * WGDPlus1 - 1 / WGDPlus1 * 2)) / WGDPlus1)
        else
            closestPoint.subY = Number((Math.floor((mouse.y + unitByWGDPlus1By2) / unit * WGDPlus1 + 1 / WGDPlus1 * 2)) / WGDPlus1)
    closestPoint.subX = Number(closestPoint.subX.toFixed(5))
    closestPoint.subY = Number(closestPoint.subY.toFixed(5))

    if (mode == 'routingWire' && grabbedPoint != undefined) {
        grabbedPoint.x = closestPoint.subX
        grabbedPoint.y = closestPoint.subY
    }
})

canvas.addEventListener('click', () => {
    if (mode == 'placingComponent' && !currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y))
        currentCircuit.components.push({
            type: componentToPlace,
            inputs: new Array(components[componentToPlace].numberOfInputs).fill('unset'),
            x: closestPoint.x,
            y: closestPoint.y
        })

    else if (mode == 'removingComponent' && currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y)) {
        for (const component of currentCircuit.components) {
            if (component.x == closestPoint.x && component.y == closestPoint.y) {
                for (let index = 0; index < currentCircuit.wires.length; index++) {
                    const wire = currentCircuit.wires[index]
                    if (wire[0].x == component.x && wire[0].y == component.y) { //see if the wire is coming out of the deleted component
                        const endPoint = wire[wire.length - 1]
                        for (const component of currentCircuit.components)
                            if (component.x == endPoint.x && component.y == endPoint.y)
                                component.inputs[endPoint.index] = 'unset'
                        currentCircuit.wires.splice(index--, 1)
                    }

                    if (wire[wire.length - 1].x == component.x && wire[wire.length - 1].y == component.y)  //see if the wire is going into the deleted component
                        currentCircuit.wires.splice(index--, 1)
                }
                currentCircuit.components.splice(currentCircuit.components.indexOf(component), 1)
            }
        }
    }

    else if (mode == 'addingWire' && closestWireConnection != undefined) {
        if (firstWireConnection != undefined && Object.keys(closestWireConnection).every(key => closestWireConnection[key] == firstWireConnection[key]))
            firstWireConnection = undefined
        else if (firstWireConnection == undefined || firstWireConnection.type == closestWireConnection.type)
            firstWireConnection = { ...closestWireConnection }
        else {
            let inputConnection, outputConnection
            if (firstWireConnection.type == 'input') {
                inputConnection = firstWireConnection
                outputConnection = closestWireConnection
            } else {
                inputConnection = closestWireConnection
                outputConnection = firstWireConnection
            }
            currentCircuit.wires.push([
                { x: outputConnection.x, y: outputConnection.y, type: outputConnection.type, index: outputConnection.index, numberOfConnections: outputConnection.numberOfConnections },
                { x: outputConnection.x + .5, y: outputConnection.y - .5 },
                { x: inputConnection.x + .5, y: inputConnection.y + 1.5 },
                { x: inputConnection.x, y: inputConnection.y, type: inputConnection.type, index: inputConnection.index, numberOfConnections: inputConnection.numberOfConnections }
            ])
            for (component of currentCircuit.components) {
                if (component.x == inputConnection.x && component.y == inputConnection.y)
                    component.inputs[inputConnection.index] = currentCircuit.components.map((component, index) => ({ ...component, index })).filter(component => component.x == outputConnection.x && component.y == outputConnection.y)[0].index
            }
            firstWireConnection = undefined
        }
    }

    else if (mode == 'routingWire') {

        //grab the parents
        let parentWire
        let grabbedIndex
        if (grabbedPoint != undefined)
            for (const wire of currentCircuit.wires)
                if (wire.includes(grabbedPoint)) {
                    parentWire = wire
                    for (const index in wire)
                        if (wire[index] == grabbedPoint) {
                            grabbedIndex = index
                            break
                        }
                    break
                }

        //grab every point at the sub cords
        let validPoints = []
        for (const wire of currentCircuit.wires)
            for (const index in wire) {
                const point = wire[index]
                if (point.x == closestPoint.subX && point.y == closestPoint.subY)
                    validPoints.push({ wire, index, point })
            }

        //handle point grabbing / dropping 
        if (validPoints.length >= 1) {

            //filter points based on priority
            if (grabbedPoint != undefined)
                if (validPoints.some(point => point.wire == parentWire)) {
                    validPoints = validPoints.filter(point => point.wire == parentWire) //this also means that grabbedPoint is in the filtered validPoints
                    if (validPoints.length > 1)
                        validPoints = validPoints.filter(point => point.point != grabbedPoint)
                }

            const { wire, index, point } = validPoints[0]
            if (grabbedPoint == undefined)  //if no point is grabbed, grab this new point
                grabbedPoint = point
            else if (grabbedPoint == point || parentWire != wire)  //if this is the point grabbed or is from another wire, drop the grabbed point
                grabbedPoint = undefined
            else { //the new point is a different point on the same wire as the grabbed point, splice out all points between
                const startIndex = Math.min(index, grabbedIndex)
                const pointsToPop = Math.max(index, grabbedIndex) - startIndex
                wire.splice(startIndex, pointsToPop)
                grabbedPoint = undefined
            }
        }

        else if (grabbedPoint == undefined) { //there is no point grabbed, and no point at the clicked sub cords, next try to create a point
            function translatePoint(point) {
                let x = point.x + .5
                let y = point.y
                if (point.type == 'input') {
                    y++
                    x = point.x + (point.index + 1) * (1 / (point.numberOfConnections + 1))
                }
                return { ...point, x, y }
            }
            outerLoop:
            for (const wire of currentCircuit.wires)
                for (let index = 0; index < wire.length - 1; index++) {
                    let pointA, pointB
                    if (wire[index].type == undefined) pointA = wire[index]
                    else pointA = translatePoint(wire[index])
                    if (wire[index + 1].type == undefined) pointB = wire[index + 1]
                    else pointB = translatePoint(wire[index + 1])
                    if (pointA.x == pointB.x && pointA.x == closestPoint.subX && Math.max(pointA.y, pointB.y) >= closestPoint.subY && Math.min(pointA.y, pointB.y) <= closestPoint.subY) {
                        wire.splice(index + 1, 0, { x: closestPoint.subX, y: closestPoint.subY })
                        grabbedPoint = wire[index + 1]
                        break outerLoop
                    }
                    else if (pointA.y == pointB.y && pointA.y == closestPoint.subY && Math.max(pointA.x, pointB.x) >= closestPoint.subX && Math.min(pointA.x, pointB.x) <= closestPoint.subX) {
                        wire.splice(index + 1, 0, { x: closestPoint.subX, y: closestPoint.subY })
                        grabbedPoint = wire[index + 1]
                        break outerLoop
                    }
                }
        }
    }

    else if (mode == 'removingWire') {
        for (const wire of currentCircuit.wires) {
            if (wire.some(point => point.x == closestPoint.subX && point.y == closestPoint.subY)) {
                const endPoint = wire[wire.length - 1]
                for (const component of currentCircuit.components)
                    if (component.x == endPoint.x && component.y == endPoint.y) {
                        component.inputs[endPoint.index] = 'unset'
                    }
                currentCircuit.wires.splice(currentCircuit.wires.indexOf(wire), 1)
                break
            }
        }
    }

    else if (mode == 'placingIO' && !currentCircuit.components.some(component => component.x == closestPoint.x && component.y == closestPoint.y))
        if (IOToPlace == 'output')
            currentCircuit.components.push({
                type: 'output',
                inputs: ['unset'],
                x: closestPoint.x,
                y: closestPoint.y
            })
        else
            currentCircuit.components.push({
                type: 'input',
                x: closestPoint.x,
                y: closestPoint.y
            })
})

render()

const readableModes = {
    'running': 'Running',
    'ticking': 'Ticking',
    'blank': 'Blank',
    'placingComponent': 'Placing component',
    'removingComponent': 'Removing component',
    'addingWire': 'Adding wire',
    'routingWire': 'Routing wire',
    'removingWire': 'Removing wire',
    'placingIO': 'Placing I/O'
}

function modeChange(oldValue, newValue) {
    if (readableModes[newValue] == undefined) throw new Error('unknown mode')
    showModeElement.children[1].children[0].children[0].innerText = readableModes[mode]

    if (oldValue == 'routingWire') grabbedPoint = undefined
    if (oldValue == 'running') showingSim = false
}