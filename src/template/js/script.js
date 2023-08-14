(function(win, doc){

    function numberWithCommas(x){
        return x.toString().replace(/\B(?=(\d{3})+(?!\d))/g, ",");
    }

    google.charts.load('current', {'packages':['corechart']});

    const lineChartOptions = {
        colors: ['#6A7583', '#bfd202'],
        legend: { position: 'bottom' },
        chartArea: {'width': '80%'},
        width: 680,
        backgroundColor: { fill:'transparent' },
        hAxis: { textPosition: 'out' },
        vAxis: { textPosition: 'out', format: 'short', title: '' },
        baselineColor: 'transparent',
        pointSize: 3,
        dataOpacity: 1
    };

    win.drawEuiTable = function(chartData, selector){
        const jsonData = {
            cols: [
                {id: 'date', label: 'Date', type: 'date'},
                {id: 'eui', label: 'Energy Use Intensity (kWh/m^2)' , type: 'number'},
                {id: 'annotation', type: 'string', role: 'annotation', allowHtml: true}
            ],
            rows: []
        }
        chartData.forEach(function(row){
            jsonData.rows.push( { c: [
                { v: row[0] }, { v: row[1] }, { v: row[2] }
            ] } );
        });

        let data = new google.visualization.DataTable(
            jsonData
        );

        let localChartOptions = Object.assign({}, lineChartOptions);
        localChartOptions.vAxis.title = 'EUI (kWh/m^2)';
        localChartOptions.hAxis.format = 'M/YYYY';
        localChartOptions.interpolateNulls = true;
        localChartOptions.vAxis.minValue = null;
        localChartOptions.fontSize = 11;
        localChartOptions.width = 980;
        localChartOptions.chartArea = {
            bottom: 40
        };
        localChartOptions.series = {
            0: {
                annotations: {
                    stem: { length: 10 },
                    textStyle: { color: '#0f264a', }
                },
            },
            1: {
                annotations: {
                    stem: { length: 25 }
                },
            }
        };
        localChartOptions.annotations = {
            textStyle: {
                fontSize: 15,
                bold: true,
            }
        }


        if(selector){
            let chart = new google.visualization.LineChart(
                document.querySelector(selector)
            );
            chart.draw(data, localChartOptions);
        }


    };

    win.drawHistogram = function(chartData, selector, marshaCode){
        let data = google.visualization.arrayToDataTable(chartData);

        let options = {
            colors: ['#6a7583'],
            chartArea: {
                width: '90%',
                left: 40,
            },
            histogram: {
                bucketSize: '800'
            },
            hAxis: {
                titleTextStyle: { italic: false },
                minorGridlines: {
                    count: 0
                },
                title: 'Carbon Usage Performance',
                textPosition: 'none'
            },
            vAxis: {
                title: 'Locations',
            },
            legend: {
                position: 'none'
            },
        };

        if(selector) {
            let container = document.querySelector(selector);
            let chart = new google.visualization.Histogram(container);

            if(marshaCode){
                google.visualization.events.addListener(chart, 'ready', function () {
                    let layout = chart.getChartLayoutInterface();
                    for (var i = 0; i < data.getNumberOfRows(); i++) {
                        const rowMarshaCode = data.getValue(i, 0);
                        if(rowMarshaCode === marshaCode){
                            const xPos = layout.getXLocation(data.getValue(i, 1));

                            const lineDiv = document.createElement('div');
                            lineDiv.classList.add('myLocation');
                            lineDiv.style.left = (xPos) + 'px';
                            container.appendChild(lineDiv);

                            const arrowDiv = document.createElement('div');
                            arrowDiv.classList.add('myLocationArrow');
                            arrowDiv.innerText = 'Your hotel';
                            arrowDiv.style.left = (xPos - 16) + 'px';
                            container.appendChild(arrowDiv);
                        }
                    }

                    const lowPerfDiv = document.createElement('div');
                    lowPerfDiv.classList.add('lowPerf');
                    lowPerfDiv.innerText = 'Low-performing';
                    container.appendChild(lowPerfDiv);

                    const highPerfDiv = document.createElement('div');
                    highPerfDiv.classList.add('highPerf');
                    highPerfDiv.innerText = 'High-performing';
                    container.appendChild(highPerfDiv);

                });
            }

            chart.draw(data, options);
        }
    };

    win.drawCandlestickChart = function(startingYear, twenty19Value, start, target, selector){

        const rawData = [
            ['2019', 0, 0, twenty19Value, twenty19Value],
            [startingYear.toString(), 0, 0, start, start],
            //['Carbon Reduction', start, start, target, target],
            ['Carbon Reduction', 0, 0, 0, 0],
            ['2030 Target', 0, 0, target, target]
        ];
        if((start-target) > 0){
            rawData[2][1] = rawData[2][2] = start;
            rawData[2][3] = rawData[2][4] = target;
        }
        var data = google.visualization.arrayToDataTable(rawData, true);

        var options = {
            legend: 'none',
            chartArea: {'width': '83%'},
            vAxis: { textPosition: 'out', format: 'short', title: 'kg CO2e' },
            hAxis: { minorGridlines: { count: 0 } },
            candlestick: {
                fallingColor: { strokeWidth: 0, fill: '#bfd202' },
                risingColor: { strokeWidth: 0, fill: '#6A7583' }
            }
        };

        if(selector){
            let chart = new google.visualization.CandlestickChart(document.querySelector('.carbonReduction .chart'));

            // add annotations to the top
            google.visualization.events.addListener(chart, 'ready', function () {
                let bars = document.querySelectorAll('.carbonReduction .chart svg > g:nth-child(3) > g')[0].lastChild.children;
                Array.from(bars).forEach(function(bar, idx){
                    const row = rawData[idx];
                    let { top, left, width } = bar.getBoundingClientRect(),
                        hint = document.createElement('div'),
                        displayVal = 0;

                    hint.style.top = (top - 16) + 'px';
                    hint.style.left = ((left + width + 5) - 62) + 'px';
                    hint.classList.add('hint');
                    if(row[1] === 0){
                        displayVal = row[3];
                    }else{
                        displayVal = row[2] - row[3];
                    }
                    hint.innerText = numberWithCommas(displayVal);
                    document.querySelector('.carbonReduction .chart').append(hint)
                })
            });

            chart.draw(data, options);
        }


    }
})(window, document);
